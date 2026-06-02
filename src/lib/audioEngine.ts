// Audio engine baseado em Web Audio API com scheduling sem gaps E memória limitada.
//
// Por quê: HTMLAudioElement tocando uma playlist tem gaps audíveis na
// transição entre faixas (carregamento do próximo .src). Pra um audiobook
// dividido em chunks de TTS, isso quebra a leitura.
//
// PROBLEMA HISTÓRICO (corrigido aqui): a versão anterior decodificava TODOS os
// chunks pra AudioBuffer (PCM cru) e os mantinha em memória pra sempre, além de
// agendar todas as `source` nodes de uma vez. PCM cru ≈ 11 MB por minuto de
// áudio (48 kHz · float32 · mono) → ~18 min ≈ 200 MB. Em PWA no Android isso
// estoura a memória do renderizador e a página crasha ("Ah, não!"). A narração
// premium "travava" sempre por volta dos 18 minutos por causa disso.
//
// COMO FUNCIONA AGORA (janela deslizante):
//   - Guarda apenas os BYTES MP3 (comprimidos, ~10x menores que o PCM) e os
//     metadados (duração, posição, chars) de TODOS os chunks. Isso é barato:
//     um capítulo inteiro cabe em poucos MB.
//   - Só DECODIFICA pra PCM e AGENDA uma JANELA em torno do playhead
//     ([pos - RETAIN_BEHIND, pos + LOOKAHEAD]). O resto fica só como bytes.
//   - Conforme o playhead avança, um "pump" (dirigido pelo rAF) agenda os
//     próximos chunks e LIBERA o PCM dos que já passaram. Memória fica limitada
//     a ~1 minuto de PCM, independente do tamanho do livro.
//   - Seek pra qualquer ponto: re-decodifica a janela alvo a partir dos bytes.
//   - 1 único AudioContext + GainNode (volume)
//   - Pause: AudioContext.suspend() congela a timeline inteira (resume retoma)
//   - Rate change: re-ancora o relógio e re-agenda a janela com novo playbackRate
//
// Limitações:
//   - Seek "pra frente" só funciona até onde já foi appendado (metadados)
//   - decodeAudioData é assíncrono e pode falhar em formatos exóticos (MP3 OK)
//   - Safari iOS exige resume() dentro de user gesture (handled em play())

export interface AudioEngineEvents {
  onTimeUpdate?: (currentTime: number, bufferedTime: number, currentChar?: number) => void;
  onEnded?: () => void;
  onChunkAppended?: (chunkIndex: number, totalBufferedSec: number) => void;
  onError?: (error: Error) => void;
  /** Dispara quando o estado de playback muda (running ↔ suspended). */
  onPlayStateChange?: (isPlaying: boolean) => void;
  /**
   * Dispara ao entrar/sair da espera por buffer (underrun no meio da narração):
   * a reprodução alcançou o último trecho já sintetizado e aguarda o próximo. A
   * UI usa isto pra avisar o usuário que é uma pausa curta e automática — não um
   * travamento.
   */
  onBuffering?: (buffering: boolean) => void;
}

// Janela de PCM mantida em memória. Decodifica até LOOKAHEAD à frente do
// playhead e mantém RETAIN_BEHIND atrás (pra seek curto pra trás instantâneo).
// ~50s de PCM ≈ 10 MB — irrelevante mesmo em livros de horas.
const LOOKAHEAD_SEC = 30;
const RETAIN_BEHIND_SEC = 20;

interface Chunk {
  index: number;
  encoded: ArrayBuffer;   // bytes MP3 originais — fonte pra (re)decodificar sob demanda
  duration: number;       // duração nativa em segundos (sabida no append)
  posStart: number;       // início na timeline do livro (soma das durações anteriores)
  posEnd: number;         // posStart + duration
  startChar?: number;
  endChar?: number;
}

interface Scheduled {
  source: AudioBufferSourceNode;
  startsAt: number;       // ctx time onde a source começou
  endsAt: number;         // ctx time onde termina (já considera playbackRate)
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  private chunks: Chunk[] = [];
  private decoded = new Map<number, AudioBuffer>();   // cache de PCM da janela viva
  private scheduled = new Map<number, Scheduled>();   // sources atualmente agendadas
  private scheduledTailIndex = -1;                    // maior índice agendado (contíguo)
  private scheduledTailCtxEnd = 0;                    // ctx time onde a cauda agendada termina

  // Relógio: pos(now) = clockAnchorPos + (ctx.currentTime - clockAnchorCtx) * rate.
  // Re-ancorado em seek/rate/underrun. Enquanto suspenso, ctx.currentTime fica
  // congelado, então a posição não anda (pause exato).
  private clockAnchorCtx = 0;
  private clockAnchorPos = 0;

  private playbackRate = 1.0;
  private volume = 1.0;
  private isMuted = false;
  private endedFired = false;
  private rafId: number | null = null;
  private pumping = false;
  private pumpAgain = false;
  private events: AudioEngineEvents = {};

  constructor(events: AudioEngineEvents = {}) {
    this.events = events;
  }

  // Cria o contexto JÁ SUSPENDED — só toca quando play() for chamado.
  // Isso evita auto-play e mantém compat com restrição de user gesture do iOS.
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    void this.ctx.suspend().catch(() => {});
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.isMuted ? 0 : this.volume;
    this.gain.connect(this.ctx.destination);
    this.clockAnchorCtx = this.ctx.currentTime;
    this.clockAnchorPos = 0;
    this.scheduledTailCtxEnd = this.ctx.currentTime;
    this.ctx.addEventListener("statechange", () => this.firePlayState());
    return this.ctx;
  }

  private firePlayState(): void {
    const playing = !!this.ctx && this.ctx.state === "running";
    this.events.onPlayStateChange?.(playing);
  }

  // ─── Append de chunks ───────────────────────────────────────────────────

  /**
   * Registra um chunk MP3. Decodifica UMA vez só pra descobrir a duração (e já
   * aproveita pra agendar, se cair na janela atual), mas guarda apenas os BYTES
   * comprimidos — o PCM fora da janela é descartado. Retorna a duração nativa.
   */
  async appendChunk(arrayBuffer: ArrayBuffer, startChar?: number, endChar?: number, _text?: string): Promise<number> {
    void _text; // aceito pra manter a mesma assinatura do HtmlAudioEngine (não usado aqui)
    const ctx = this.ensureContext();
    // Preserva os bytes originais: decodeAudioData "detacha" o ArrayBuffer.
    const encoded = arrayBuffer.slice(0);
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(encoded.slice(0));
    } catch (e) {
      const err = new Error(`Falha ao decodificar áudio: ${(e as Error).message}`);
      this.events.onError?.(err);
      throw err;
    }

    const prev = this.chunks[this.chunks.length - 1];
    const posStart = prev ? prev.posEnd : 0;
    const duration = audioBuffer.duration;
    const idx = this.chunks.length;
    this.chunks.push({
      index: idx,
      encoded,
      duration,
      posStart,
      posEnd: posStart + duration,
      startChar,
      endChar,
    });

    // Mantém o PCM em cache só se o chunk já está na janela viva; senão descarta
    // (será re-decodificado quando o playhead se aproximar). Mesmo na 1ª vez,
    // isso impede acumular o livro inteiro em PCM.
    const pos = this.currentPos();
    if (posStart <= pos + LOOKAHEAD_SEC && posStart + duration >= pos - RETAIN_BEHIND_SEC) {
      this.decoded.set(idx, audioBuffer);
    }

    this.endedFired = false;
    void this.pump();

    this.events.onChunkAppended?.(idx, this.getBufferedDuration());
    return duration;
  }

  private createSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.gain!);
    return source;
  }

  private async ensureDecoded(idx: number): Promise<AudioBuffer | null> {
    const cached = this.decoded.get(idx);
    if (cached) return cached;
    const chunk = this.chunks[idx];
    if (!chunk || !this.ctx) return null;
    try {
      const buffer = await this.ctx.decodeAudioData(chunk.encoded.slice(0));
      this.decoded.set(idx, buffer);
      return buffer;
    } catch (e) {
      this.events.onError?.(new Error(`Falha ao decodificar áudio: ${(e as Error).message}`));
      return null;
    }
  }

  // ─── Pump: mantém a janela agendada/decodificada e poda o que passou ──────

  private async pump(): Promise<void> {
    if (!this.ctx) return;
    if (this.pumping) { this.pumpAgain = true; return; }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        await this.pumpOnce();
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
  }

  private async pumpOnce(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.chunks.length === 0) return;

    const pos = this.currentPos();
    const coverIdx = this.indexAtPos(pos);
    if (coverIdx < 0) return;

    // (Re)ancora o agendamento se o chunk que cobre o playhead não está agendado
    // (início, seek, rate change, ou underrun depois de uma pausa de decode).
    if (!this.scheduled.has(coverIdx)) {
      this.clearScheduledSources();
      const offset = Math.max(0, pos - this.chunks[coverIdx].posStart);
      const ok = await this.scheduleChunk(coverIdx, ctx.currentTime + 0.05, offset, pos);
      if (!ok) return;
    }

    // Estende a cauda à frente até cobrir LOOKAHEAD de áudio agendado.
    while (
      this.scheduledTailIndex + 1 < this.chunks.length &&
      (this.scheduledTailCtxEnd - ctx.currentTime) * this.playbackRate < LOOKAHEAD_SEC
    ) {
      const next = this.scheduledTailIndex + 1;
      const ok = await this.scheduleChunk(next, this.scheduledTailCtxEnd, 0, null);
      if (!ok) break;
    }

    this.pruneOutsideWindow(pos);
  }

  /**
   * Agenda o chunk `idx` pra tocar a partir de `startsAtCtx` (ctx time), começando
   * do `offset` interno (segundos nativos). Se `reanchorPos` != null, re-ancora o
   * relógio nesse ponto da timeline do livro. Decodifica sob demanda.
   */
  private async scheduleChunk(
    idx: number,
    startsAtCtx: number,
    offset: number,
    reanchorPos: number | null,
  ): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    const chunk = this.chunks[idx];
    if (!chunk) return false;

    const buffer = await this.ensureDecoded(idx);
    if (!buffer || !this.ctx) return false;

    // Underrun: o tempo agendado já passou (decode demorou). Recomeça "agora" e
    // re-ancora o relógio nesse ponto pra áudio e barra não dessincronizarem.
    let startsAt = startsAtCtx;
    let reanchor = reanchorPos;
    if (startsAt < ctx.currentTime + 0.02) {
      startsAt = ctx.currentTime + 0.05;
      reanchor = chunk.posStart + offset;
    }

    const source = this.createSource(buffer);
    source.start(startsAt, Math.min(offset, Math.max(0, chunk.duration - 0.001)));
    const remaining = (chunk.duration - offset) / this.playbackRate;
    const endsAt = startsAt + remaining;

    this.scheduled.set(idx, { source, startsAt, endsAt });
    this.scheduledTailIndex = idx;
    this.scheduledTailCtxEnd = endsAt;

    if (reanchor !== null) {
      this.clockAnchorCtx = startsAt;
      this.clockAnchorPos = reanchor;
    }
    return true;
  }

  /** Libera PCM e para sources fora de [pos - RETAIN_BEHIND, pos + LOOKAHEAD]. */
  private pruneOutsideWindow(pos: number): void {
    const lo = pos - RETAIN_BEHIND_SEC;
    const hi = pos + LOOKAHEAD_SEC;

    for (const [idx, s] of this.scheduled) {
      const c = this.chunks[idx];
      if (!c) continue;
      if (c.posEnd < lo) {
        try { s.source.stop(); s.source.disconnect(); } catch { /* já parado */ }
        this.scheduled.delete(idx);
      }
    }
    for (const idx of this.decoded.keys()) {
      const c = this.chunks[idx];
      if (!c) { this.decoded.delete(idx); continue; }
      if (c.posEnd < lo || c.posStart > hi) {
        this.decoded.delete(idx);
      }
    }
  }

  private clearScheduledSources(): void {
    for (const [, s] of this.scheduled) {
      try { s.source.stop(); s.source.disconnect(); } catch { /* ignore */ }
    }
    this.scheduled.clear();
    this.scheduledTailIndex = -1;
    this.scheduledTailCtxEnd = this.ctx ? this.ctx.currentTime : 0;
  }

  // ─── Controles ──────────────────────────────────────────────────────────

  async play(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.startTimeUpdateLoop();
    void this.pump();
    this.firePlayState();
  }

  async pause(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === "running") {
      await this.ctx.suspend();
    }
    this.stopTimeUpdateLoop();
    this.firePlayState();
  }

  isPaused(): boolean {
    return !this.ctx || this.ctx.state !== "running";
  }

  /**
   * Pula pra um tempo específico no áudio (segundos, base nativa). Re-ancora a
   * janela: limpa o agendamento atual e o pump re-decodifica/agenda a partir do
   * alvo (mesmo que o PCM de lá já tenha sido liberado).
   */
  seek(targetSec: number): void {
    if (!this.ctx || this.chunks.length === 0) return;
    const safeTarget = Math.max(0, Math.min(targetSec, this.getBufferedDuration() - 0.01));
    this.clearScheduledSources();
    // Re-ancora o relógio de imediato pra getCurrentTime refletir o alvo já no
    // próximo frame; o pump materializa o áudio logo em seguida.
    this.clockAnchorCtx = this.ctx.currentTime;
    this.clockAnchorPos = safeTarget;
    this.endedFired = false;
    this.startTimeUpdateLoop();
    void this.pump();
  }

  seekBy(deltaSec: number): void {
    this.seek(this.getCurrentTime() + deltaSec);
  }

  setRate(rate: number): void {
    if (rate <= 0) return;
    if (!this.ctx) {
      this.playbackRate = rate;
      return;
    }
    const wasPlaying = !this.isPaused();
    const curTime = this.getCurrentTime();
    this.playbackRate = rate;
    // Re-agenda a janela do tempo atual com o novo rate.
    this.seek(curTime);
    if (!wasPlaying) {
      void this.pause();
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && !this.isMuted) {
      this.gain.gain.value = this.volume;
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.gain) {
      this.gain.gain.value = muted ? 0 : this.volume;
    }
  }

  // ─── Getters ────────────────────────────────────────────────────────────

  /** Posição atual do playhead na timeline do livro (segundos nativos). */
  private currentPos(): number {
    if (!this.ctx || this.chunks.length === 0) return 0;
    const elapsed = (this.ctx.currentTime - this.clockAnchorCtx) * this.playbackRate;
    const pos = this.clockAnchorPos + Math.max(0, elapsed);
    return Math.max(0, Math.min(pos, this.getBufferedDuration()));
  }

  getCurrentTime(): number {
    return this.currentPos();
  }

  getBufferedDuration(): number {
    const last = this.chunks[this.chunks.length - 1];
    return last ? last.posEnd : 0;
  }

  getRate(): number {
    return this.playbackRate;
  }

  getVolume(): number {
    return this.volume;
  }

  isMutedNow(): boolean {
    return this.isMuted;
  }

  /** Índice do chunk que cobre a posição `pos` (ou o último, no fim). */
  private indexAtPos(pos: number): number {
    if (this.chunks.length === 0) return -1;
    for (const c of this.chunks) {
      if (pos < c.posEnd) return c.index;
    }
    return this.chunks.length - 1;
  }

  /** Tempo (s) onde um caractere é narrado; -1 se além do que foi sintetizado. */
  timeForChar(char: number): number {
    if (this.chunks.length === 0) return -1;
    const last = this.chunks[this.chunks.length - 1];
    if (last.endChar !== undefined && char >= last.endChar) return -1;
    for (const c of this.chunks) {
      if (c.startChar === undefined || c.endChar === undefined) continue;
      if (char < c.endChar || c.index === this.chunks.length - 1) {
        const range = Math.max(1, c.endChar - c.startChar);
        const frac = Math.max(0, Math.min(1, (char - c.startChar) / range));
        return c.posStart + frac * c.duration;
      }
    }
    return -1;
  }

  getCurrentChar(): number {
    if (this.chunks.length === 0) return 0;
    const pos = this.currentPos();
    let lastChar = 0;
    for (const c of this.chunks) {
      const hasChars = c.startChar !== undefined && c.endChar !== undefined;
      if (pos < c.posStart) return c.startChar ?? lastChar;
      if (pos < c.posEnd) {
        if (!hasChars) return lastChar;
        const ratio = Math.min(1, (pos - c.posStart) / Math.max(0.001, c.duration));
        return c.startChar! + ratio * (c.endChar! - c.startChar!);
      }
      if (c.endChar !== undefined) lastChar = c.endChar;
    }
    return lastChar;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /** Para tudo, descarta chunks, fecha o contexto. */
  destroy(): void {
    this.stopTimeUpdateLoop();
    this.clearScheduledSources();
    this.decoded.clear();
    this.chunks = [];
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.gain = null;
    }
  }

  /** Limpa chunks/estado mas mantém o contexto aberto (mais leve que destroy). */
  reset(): void {
    this.clearScheduledSources();
    this.decoded.clear();
    this.chunks = [];
    if (this.ctx) {
      this.clockAnchorCtx = this.ctx.currentTime;
      this.scheduledTailCtxEnd = this.ctx.currentTime;
    }
    this.clockAnchorPos = 0;
    this.endedFired = false;
  }

  // ─── Loop de eventos (timeUpdate, ended) + pump ─────────────────────────

  private startTimeUpdateLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      const ct = this.getCurrentTime();
      const buf = this.getBufferedDuration();
      const cc = this.getCurrentChar();
      this.events.onTimeUpdate?.(ct, buf, cc);
      // Mantém a janela alimentada e poda o passado.
      void this.pump();
      // ended: o playhead alcançou o fim de tudo que foi appendado, tocando.
      if (
        !this.endedFired &&
        buf > 0 &&
        ct >= buf - 0.05 &&
        this.scheduledTailIndex >= this.chunks.length - 1 &&
        this.ctx &&
        this.ctx.state === "running"
      ) {
        this.endedFired = true;
        this.events.onEnded?.();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTimeUpdateLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
