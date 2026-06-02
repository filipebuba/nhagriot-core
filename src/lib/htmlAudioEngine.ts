import type { AudioEngineEvents } from "./audioEngine";
import { buildCharWeights, audioFracToCharFrac, charFracToAudioFrac } from "./charTiming";
import type { CharWeights } from "./charTiming";

interface AudioChunk {
  url: string;
  duration: number;
  startChar?: number;
  endChar?: number;
  text?: string;          // texto falado — pra mapear tempo↔char com pausas
  weights?: CharWeights;  // cache lazy dos pesos de pontuação
}

// Compensa o silêncio inicial do TTS: segura a marcação no começo do trecho por
// um instante pra ela não largar à frente da voz. Errar levemente atrasado lê
// melhor que adiantado num "acompanhe a leitura".
const HIGHLIGHT_LEAD_SEC = 0.25;

export class HtmlAudioEngine {
  private audio: HTMLAudioElement;
  private chunks: AudioChunk[] = [];
  private idx = 0;
  private playing = false;
  private playbackRate = 1;
  private events: AudioEngineEvents;
  private rafId: number | null = null;
  // Buffer underrun vs. fim do livro:
  //  - endOfStream = a síntese terminou TODOS os trechos (Player chama markEndOfStream).
  //  - waitingForBuffer = a reprodução alcançou o último trecho sintetizado mas a
  //    síntese ainda não acabou → ficamos "tocando" (playing=true), em espera, e o
  //    próximo appendChunk retoma sozinho. Sem isto, o player parava no buffer-edge
  //    e exigia o usuário apertar play de novo a cada trecho que faltava sintetizar.
  private endOfStream = false;
  private waitingForBuffer = false;

  // Atualiza o estado de espera por buffer e notifica a UI só na mudança (evita
  // spam de eventos). Centraliza pra que todo caminho (underrun, resume, pause,
  // seek, fim, reset) mantenha o indicador "Sincronizando…" coerente.
  private setWaiting(v: boolean): void {
    if (this.waitingForBuffer === v) return;
    this.waitingForBuffer = v;
    this.events.onBuffering?.(v);
  }

  constructor(events: AudioEngineEvents = {}) {
    this.events = events;
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.setAttribute("playsinline", "true");
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", () => {
      this.events.onError?.(new Error("Falha ao reproduzir audio."));
    });
    // Corrige a duração ARMAZENADA do chunk atual com a duração REAL do arquivo
    // assim que o navegador a conhece. A estimada no append (readDuration) pode
    // vir curta → o destaque correria na frente da voz, e a barra dessincroniza.
    this.audio.addEventListener("durationchange", () => {
      const d = this.audio.duration;
      const c = this.chunks[this.idx];
      if (c && Number.isFinite(d) && d > 0) c.duration = d;
    });
  }

  async appendChunk(
    arrayBuffer: ArrayBuffer,
    startChar?: number,
    endChar?: number,
    text?: string,
  ): Promise<number> {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const duration = await readDuration(url);
    const chunk: AudioChunk = { url, duration, startChar, endChar, text };
    this.chunks.push(chunk);
    this.events.onChunkAppended?.(this.chunks.length - 1, this.getBufferedDuration());

    if (this.chunks.length === 1) {
      this.loadCurrent(0);
      if (this.playing) await this.play();
    } else if (this.waitingForBuffer && this.playing) {
      // Estávamos em underrun esperando exatamente este trecho — retoma sem gap
      // nem toque do usuário. Avança pro trecho recém-chegado e toca.
      this.setWaiting(false);
      this.idx = this.chunks.length - 1;
      this.loadCurrent(0);
      this.startLoop();
      await this.audio.play().catch(() => {});
      this.firePlayState();
    }
    return duration;
  }

  /**
   * Sinaliza que a síntese terminou TODOS os trechos. Só depois disto um
   * `ended` no último trecho é o fim real do livro; antes, é buffer underrun
   * (a narração espera o próximo trecho e retoma sozinha).
   */
  markEndOfStream(): void {
    this.endOfStream = true;
    // Se já estávamos parados na borda do buffer esperando mais áudio que nunca
    // virá, finaliza de verdade agora.
    if (this.waitingForBuffer && this.idx + 1 >= this.chunks.length) {
      this.setWaiting(false);
      this.playing = false;
      this.stopLoop();
      this.firePlayState();
      this.events.onEnded?.();
    }
  }

  async play(): Promise<void> {
    if (this.chunks.length === 0) {
      this.playing = true;
      this.firePlayState();
      return;
    }
    this.playing = true;
    this.audio.playbackRate = this.playbackRate;
    await this.audio.play();
    this.startLoop();
    this.firePlayState();
  }

  async pause(): Promise<void> {
    this.playing = false;
    this.setWaiting(false);
    this.audio.pause();
    this.stopLoop();
    this.firePlayState();
  }

  isPaused(): boolean {
    // Em underrun (esperando o próximo trecho sintetizar) estamos logicamente
    // tocando, embora o elemento <audio> esteja momentaneamente parado. Reportar
    // "tocando" evita a UI/Media Session piscarem pra pausado e mantém o
    // auto-resume — o usuário não precisa apertar play.
    if (this.waitingForBuffer && this.playing) return false;
    return !this.playing || this.audio.paused;
  }

  seek(targetSec: number): void {
    // Um seek manual sai do estado de espera por buffer.
    this.setWaiting(false);
    const total = this.getBufferedDuration();
    const safe = Math.max(0, Math.min(targetSec, Math.max(0, total - 0.01)));
    let acc = 0;
    for (let i = 0; i < this.chunks.length; i += 1) {
      const chunk = this.chunks[i];
      if (acc + chunk.duration >= safe || i === this.chunks.length - 1) {
        this.idx = i;
        this.loadCurrent(Math.max(0, safe - acc));
        if (this.playing) void this.audio.play().catch(() => {});
        this.emitTime();
        return;
      }
      acc += chunk.duration;
    }
  }

  seekBy(deltaSec: number): void {
    this.seek(this.getCurrentTime() + deltaSec);
  }

  setRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(3, rate));
    this.audio.playbackRate = this.playbackRate;
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  getCurrentTime(): number {
    return this.chunks
      .slice(0, this.idx)
      .reduce((acc, c) => acc + c.duration, 0) + (this.audio.currentTime || 0);
  }

  getBufferedDuration(): number {
    return this.chunks.reduce((acc, c) => acc + c.duration, 0);
  }

  private weightsFor(chunk: AudioChunk): CharWeights | null {
    if (!chunk.text) return null;
    if (!chunk.weights) chunk.weights = buildCharWeights(chunk.text);
    return chunk.weights;
  }

  getCurrentChar(): number {
    const chunk = this.chunks[this.idx];
    if (!chunk || chunk.startChar === undefined || chunk.endChar === undefined) return 0;
    // Usa a duração REAL do elemento tocando (fonte da verdade) em vez da estimada
    // no append — é o que evita o destaque adiantar em relação à narração.
    const dur =
      Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : chunk.duration;
    // Segura a marcação no início (silêncio do TTS) pra não largar à frente.
    const t = Math.max(0, (this.audio.currentTime || 0) - HIGHLIGHT_LEAD_SEC);
    const audioFrac = Math.min(1, t / Math.max(0.01, dur));
    // Mapeamento que respeita as pausas de pontuação (se temos o texto), senão
    // linear como antes.
    const weights = this.weightsFor(chunk);
    const charFrac = weights ? audioFracToCharFrac(weights, audioFrac) : audioFrac;
    const range = chunk.endChar - chunk.startChar;
    // Nunca alcança o fim exato do trecho (= início do próximo parágrafo): durante
    // a pausa por buffer isso faria a marca "pular" pro texto ainda não lido.
    const maxChar = chunk.endChar - (range > 1 ? 1 : 0);
    return Math.min(maxChar, chunk.startChar + charFrac * range);
  }

  /**
   * Tempo de áudio (segundos, base do livro) onde um caractere do fullText é
   * narrado. Usado pra "tocar numa palavra e a narração ir pra lá". Retorna -1
   * se o caractere ainda não foi sintetizado (além do buffer) — aí o chamador
   * usa uma estimativa e o seek vira pendente.
   */
  timeForChar(char: number): number {
    if (this.chunks.length === 0) return -1;
    const last = this.chunks[this.chunks.length - 1];
    if (last.endChar !== undefined && char >= last.endChar) return -1;
    let base = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.startChar === undefined || c.endChar === undefined) {
        base += c.duration;
        continue;
      }
      if (char < c.endChar || i === this.chunks.length - 1) {
        const range = Math.max(1, c.endChar - c.startChar);
        const charFrac = Math.max(0, Math.min(1, (char - c.startChar) / range));
        const weights = this.weightsFor(c);
        const audioFrac = weights ? charFracToAudioFrac(weights, charFrac) : charFrac;
        return base + audioFrac * c.duration;
      }
      base += c.duration;
    }
    return -1;
  }

  reset(): void {
    void this.pause();
    this.revokeUrls();
    this.chunks = [];
    this.idx = 0;
    this.endOfStream = false;
    this.setWaiting(false);
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  destroy(): void {
    this.reset();
    this.audio.removeEventListener("ended", this.handleEnded);
  }

  private handleEnded = (): void => {
    if (this.idx + 1 < this.chunks.length) {
      this.idx += 1;
      this.loadCurrent(0);
      if (this.playing) void this.audio.play().catch(() => {});
      return;
    }
    // Alcançamos o último trecho sintetizado.
    if (!this.endOfStream) {
      // Buffer underrun: a síntese ainda não acabou. NÃO encerra — fica em
      // espera "tocando" e o próximo appendChunk retoma. Mantém o loop de tempo
      // rodando pra UI/Media Session continuarem coerentes (estado = tocando).
      this.setWaiting(true);
      return;
    }
    // Fim real do livro (síntese 100% concluída).
    this.playing = false;
    this.stopLoop();
    this.firePlayState();
    this.events.onEnded?.();
  };

  private loadCurrent(offset: number): void {
    const chunk = this.chunks[this.idx];
    if (!chunk) return;
    if (this.audio.src !== chunk.url) this.audio.src = chunk.url;
    this.audio.playbackRate = this.playbackRate;
    try {
      this.audio.currentTime = Math.max(0, Math.min(offset, Math.max(0, chunk.duration - 0.01)));
    } catch {
      // Some iOS versions reject currentTime until metadata is ready.
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.emitTime();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private emitTime(): void {
    this.events.onTimeUpdate?.(
      this.getCurrentTime(),
      this.getBufferedDuration(),
      this.getCurrentChar(),
    );
  }

  private firePlayState(): void {
    this.events.onPlayStateChange?.(this.playing && !this.audio.paused);
  }

  private revokeUrls(): void {
    for (const chunk of this.chunks) URL.revokeObjectURL(chunk.url);
  }
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : 0.5;
      audio.removeAttribute("src");
      audio.load();
      resolve(duration);
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", finish, { once: true });
    audio.addEventListener("error", () => resolve(0.5), { once: true });
    audio.src = url;
  });
}
