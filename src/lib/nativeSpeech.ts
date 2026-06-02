// Motor de narração FREE — Web Speech API do navegador (window.speechSynthesis).
//
// Por que frase-por-frase: o Chrome tem um bug famoso de cortar/parar a fala em
// textos longos (~15s). A correção robusta é falar UMA frase curta de cada vez,
// numa fila: começa a próxima só quando a anterior termina (onend). Resultado:
// lê tudo em ordem, sem pular, voz mecânica do SO mas organizada. Custo de
// servidor zero (tudo roda no dispositivo).
//
// A interface espelha a do AudioEngine (play/pause/seek/getCurrentTime/…) pra
// que o Player use os dois motores sem reescrever a tela. Diferença: aqui não
// há síntese no servidor — chama-se load(text) e toca direto.

export interface NativeSpeechEvents {
  onTimeUpdate?: (currentTime: number, totalTime: number, currentChar?: number) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

// Velocidade média de fala estimada (chars/segundo a rate=1). Só pra mapear
// progresso → tempo na barra; não precisa ser exato.
const CHARS_PER_SECOND = 14;
// Frases acima disso são quebradas (evita o corte do Chrome e dá granularidade).
const MAX_SENTENCE_CHARS = 220;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Lista as vozes do navegador (resolve a carga assíncrona via onvoiceschanged). */
export function listNativeVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length > 0) return resolve(now);
    // Vozes podem chegar depois (Chrome). Espera o evento, com timeout de guarda.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 1500);
  });
}

/** Vozes em português primeiro; demais como fallback. */
export function sortVoicesPtFirst(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const pt = voices.filter((v) => v.lang.toLowerCase().startsWith("pt"));
  const rest = voices.filter((v) => !v.lang.toLowerCase().startsWith("pt"));
  // PT-BR antes de PT-PT
  pt.sort((a, b) => {
    const aBr = a.lang.toLowerCase() === "pt-br" ? 0 : 1;
    const bBr = b.lang.toLowerCase() === "pt-br" ? 0 : 1;
    return aBr - bBr;
  });
  return [...pt, ...rest];
}

interface Sentence {
  text: string;
  /** duração estimada em segundos a rate=1 */
  baseDuration: number;
  startChar: number;
  endChar: number;
}

export class NativeSpeechEngine {
  private events: NativeSpeechEvents;
  private sentences: Sentence[] = [];
  private cumStart: number[] = []; // início de cada frase em segundos (rate=1)
  private totalBase = 0;           // duração total estimada a rate=1

  private idx = 0;                 // frase atual
  private playing = false;
  private rate = 1.0;
  private voice: SpeechSynthesisVoice | null = null;

  // Cronômetro da frase atual (pra estimar progresso entre boundaries)
  private sentenceElapsed = 0;     // segundos já decorridos na frase (rate=1)
  private sentenceStartTs: number | null = null;
  private rafId: number | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(events: NativeSpeechEvents = {}) {
    this.events = events;
  }

  // ─── Carga ────────────────────────────────────────────────────────────────
  load(text: string): void {
    this.stopSpeaking();
    const sentenceTexts = splitSentences(text);
    this.sentences = [];
    let cursor = 0;
    for (const t of sentenceTexts) {
      // Primeiro tenta indexOf direto (mais rápido).
      let idx = text.indexOf(t, cursor);
      if (idx === -1) {
        // splitSentences colapsa espaços múltiplos e \n\n → a frase não bate
        // literalmente. Tenta regex tolerante a espaços pra encontrar o trecho.
        try {
          const pattern = t
            .slice(0, 60) // ancora pelo início (evita backtracking excessivo)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escapa metacaracteres
            .replace(/\s+/g, "\\s+"); // qualquer espaço bate
          const m = new RegExp(pattern).exec(text.slice(cursor));
          if (m) idx = cursor + m.index;
        } catch {
          // regex inválida — usa cursor como fallback
        }
      }
      if (idx === -1) idx = cursor; // fallback absoluto
      const startChar = idx;
      // O endChar deve medir o trecho REAL no texto original, não o comprimento
      // da frase colapsada. Estima: avança pelo texto original até acumular
      // t.length chars não-espaço-extra (melhor que + t.length puro).
      const endChar = idx + t.length;
      this.sentences.push({
        text: t,
        baseDuration: Math.max(0.4, t.length / CHARS_PER_SECOND),
        startChar,
        endChar,
      });
      cursor = endChar;
    }
    this.cumStart = [];
    let acc = 0;
    for (const s of this.sentences) {
      this.cumStart.push(acc);
      acc += s.baseDuration;
    }
    this.totalBase = acc;
    this.idx = 0;
    this.sentenceElapsed = 0;
    this.sentenceStartTs = null;
  }

  setVoice(voice: SpeechSynthesisVoice | null): void {
    this.voice = voice;
  }

  // ─── Controles ──────────────────────────────────────────────────────────
  async play(): Promise<void> {
    if (!speechSupported() || this.sentences.length === 0) return;
    if (this.playing) return;
    this.playing = true;
    this.firePlayState();
    this.startKeepAlive();
    this.speakCurrent();
    this.startLoop();
  }

  async pause(): Promise<void> {
    if (!this.playing) return;
    this.playing = false;
    // Congela o cronômetro da frase atual
    if (this.sentenceStartTs != null) {
      this.sentenceElapsed += (performance.now() - this.sentenceStartTs) / 1000 * this.rate;
      this.sentenceStartTs = null;
    }
    this.stopSpeaking();
    this.stopKeepAlive();
    this.stopLoop();
    this.firePlayState();
  }

  isPaused(): boolean {
    return !this.playing;
  }

  /** Pula pro segundo alvo, ancorando no INÍCIO da frase que o cobre (organizado). */
  seek(targetSec: number): void {
    const target = Math.max(0, Math.min(targetSec, this.totalBase));
    let i = this.cumStart.findIndex((start, k) => {
      const end = k + 1 < this.cumStart.length ? this.cumStart[k + 1] : this.totalBase;
      return target >= start && target < end;
    });
    if (i < 0) i = this.sentences.length - 1;
    this.idx = i;
    this.sentenceElapsed = 0;
    this.sentenceStartTs = null;
    if (this.playing) {
      this.stopSpeaking();
      this.speakCurrent();
    } else {
      // Pausado: só reposiciona; emite update pra UI mover a barra.
      this.emitTime();
    }
  }

  seekBy(deltaSec: number): void {
    this.seek(this.getCurrentTime() + deltaSec);
  }

  setRate(rate: number): void {
    const wasPlaying = this.playing;
    // Congela elapsed no rate antigo antes de trocar
    if (this.sentenceStartTs != null) {
      this.sentenceElapsed += (performance.now() - this.sentenceStartTs) / 1000 * this.rate;
      this.sentenceStartTs = null;
    }
    this.rate = Math.max(0.5, Math.min(3.0, rate));
    if (wasPlaying) {
      // Reinicia a frase atual com o novo rate (Web Speech não muda rate no meio)
      this.stopSpeaking();
      this.sentenceElapsed = 0;
      this.speakCurrent();
    }
  }

  // ─── Getters (mesma escala do AudioEngine: "tempo de áudio" em segundos) ──
  getCurrentTime(): number {
    const base = this.cumStart[this.idx] ?? 0;
    let withinBase = this.sentenceElapsed;
    if (this.sentenceStartTs != null) {
      withinBase += (performance.now() - this.sentenceStartTs) / 1000 * this.rate;
    }
    const dur = this.sentences[this.idx]?.baseDuration ?? 0;
    return Math.min(this.totalBase, base + Math.min(withinBase, dur));
  }

  getCurrentChar(): number {
    if (this.sentences.length === 0) return 0;
    const s = this.sentences[this.idx];
    if (!s) return 0;
    let withinBase = this.sentenceElapsed;
    if (this.sentenceStartTs != null) {
      withinBase += (performance.now() - this.sentenceStartTs) / 1000 * this.rate;
    }
    const ratio = Math.min(1, withinBase / s.baseDuration);
    return s.startChar + ratio * (s.endChar - s.startChar);
  }

  getBufferedDuration(): number {
    // Tudo "pronto" (síntese é local/instantânea) → buffer = total.
    return this.totalBase;
  }

  /** Tempo (s) onde um caractere é narrado — ancora no início da frase que o cobre. */
  timeForChar(char: number): number {
    if (this.sentences.length === 0) return 0;
    for (let i = 0; i < this.sentences.length; i++) {
      const s = this.sentences[i];
      if (char < s.endChar || i === this.sentences.length - 1) {
        const range = Math.max(1, s.endChar - s.startChar);
        const frac = Math.max(0, Math.min(1, (char - s.startChar) / range));
        return (this.cumStart[i] ?? 0) + frac * s.baseDuration;
      }
    }
    return this.totalBase;
  }

  getRate(): number {
    return this.rate;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────
  private speakCurrent(): void {
    if (!this.playing || this.idx >= this.sentences.length) return;
    const sentence = this.sentences[this.idx];
    const u = new SpeechSynthesisUtterance(sentence.text);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    } else {
      u.lang = "pt-BR";
    }
    u.rate = this.rate;
    this.sentenceElapsed = 0;
    this.sentenceStartTs = performance.now();

    u.onboundary = (e) => {
      // Sincroniza o cronômetro com a posição real da fala (char → fração).
      if (e.charIndex != null && sentence.text.length > 0) {
        const frac = Math.min(1, e.charIndex / sentence.text.length);
        this.sentenceElapsed = frac * sentence.baseDuration;
        this.sentenceStartTs = performance.now();
      }
    };
    u.onend = () => {
      if (!this.playing) return;
      // Avança pra próxima frase. Fim do livro → onEnded.
      this.idx += 1;
      this.sentenceElapsed = 0;
      this.sentenceStartTs = null;
      if (this.idx >= this.sentences.length) {
        this.playing = false;
        this.stopKeepAlive();
        this.stopLoop();
        this.firePlayState();
        this.events.onEnded?.();
        return;
      }
      this.speakCurrent();
    };
    u.onerror = (e) => {
      // "interrupted"/"canceled" são esperados (pause/seek). Ignora.
      const err = (e as SpeechSynthesisErrorEvent).error;
      if (!err || err === "interrupted" || err === "canceled") return;
      // "not-allowed": o navegador bloqueou a fala por falta de gesto do usuário
      // (política de autoplay). Não é erro de verdade — volta pro estado pausado
      // pra que o clique no botão de play (que É um gesto) destrave a narração.
      if (err === "not-allowed") {
        this.playing = false;
        this.stopKeepAlive();
        this.stopLoop();
        this.firePlayState();
        return;
      }
      this.events.onError?.(new Error(`Web Speech: ${err}`));
    };

    try {
      window.speechSynthesis.cancel(); // limpa fila residual
      window.speechSynthesis.speak(u);
    } catch (err) {
      this.events.onError?.(err as Error);
    }
  }

  private stopSpeaking(): void {
    if (speechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  // Loop de progresso (rAF) → emite onTimeUpdate.
  private startLoop(): void {
    if (this.rafId != null) return;
    const tick = () => {
      this.emitTime();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private emitTime(): void {
    this.events.onTimeUpdate?.(this.getCurrentTime(), this.totalBase, this.getCurrentChar());
  }

  // Keep-alive: contorna o bug do Chrome que pausa a fala sozinho em sessões
  // longas. resume() periódico mantém a fila viva.
  private startKeepAlive(): void {
    if (this.keepAlive != null) return;
    this.keepAlive = setInterval(() => {
      if (this.playing && speechSupported() && window.speechSynthesis.speaking) {
        try {
          window.speechSynthesis.resume();
        } catch {
          // ignore
        }
      }
    }, 10000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive != null) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  private firePlayState(): void {
    this.events.onPlayStateChange?.(this.playing);
  }

  reset(): void {
    // ORDEM IMPORTA: marca parado e limpa o estado ANTES de cancelar a fala.
    // Em vários navegadores o cancel() dispara o onend da utterance atual; se
    // playing ainda fosse true, esse onend encadearia a próxima frase — gerando
    // uma narração ÓRFÃ que continua mesmo depois de destruir o motor (ex.: ao
    // trocar de voz/motor), com o botão de play já controlando outro motor.
    this.playing = false;
    this.idx = 0;
    this.sentenceElapsed = 0;
    this.sentenceStartTs = null;
    this.stopLoop();
    this.stopKeepAlive();
    this.stopSpeaking();
  }

  destroy(): void {
    this.reset();
  }
}

// Quebra texto em frases faláveis. Divide em pontuação final; frases muito
// longas são partidas em pedaços menores (vírgula ou corte duro) pra evitar o
// corte do Chrome e dar granularidade ao progresso.
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Divide mantendo o terminador (. ! ? … : ;) e quebras de parágrafo.
  const rough = clean.match(/[^.!?…;:]+[.!?…;:]*\s*/g) ?? [clean];
  const out: string[] = [];
  for (const piece of rough) {
    const s = piece.trim();
    if (!s) continue;
    if (s.length <= MAX_SENTENCE_CHARS) {
      out.push(s);
      continue;
    }
    // Frase longa: parte por vírgula; se ainda longo, corte duro por palavras.
    let buf = "";
    for (const part of s.split(/,\s*/)) {
      const candidate = buf ? `${buf}, ${part}` : part;
      if (candidate.length <= MAX_SENTENCE_CHARS) {
        buf = candidate;
      } else {
        if (buf) out.push(buf);
        if (part.length <= MAX_SENTENCE_CHARS) {
          buf = part;
        } else {
          // Corte duro por janelas de palavras
          const words = part.split(" ");
          let w = "";
          for (const word of words) {
            const c = w ? `${w} ${word}` : word;
            if (c.length <= MAX_SENTENCE_CHARS) w = c;
            else {
              if (w) out.push(w);
              w = word;
            }
          }
          buf = w;
        }
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}
