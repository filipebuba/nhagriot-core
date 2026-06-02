// Mapeia tempo de áudio ↔ posição de caractere dando PESO extra à pontuação.
//
// Por quê: o TTS (Piper/Kokoro) pausa em vírgulas, pontos e fim de parágrafo,
// mas só sabemos a DURAÇÃO total de cada trecho — não o tempo por palavra. O
// mapeamento linear (char ∝ tempo) ignorava essas pausas, então a marcação
// "corria à frente" da voz durante cada pausa e parecia muito adiantada.
//
// Solução: distribuir a duração do trecho dando "peso" extra nos sinais de
// pontuação. A marcação anda rápido no texto corrido e ESPERA na pontuação,
// como a voz faz. Não é timing por palavra real, mas elimina o descompasso.

export interface CharWeights {
  cum: Float64Array; // cum[i] = peso acumulado ANTES do char i (len = text.length+1)
  total: number;
}

// Pesos (em "chars equivalentes") somados ao cruzar cada pontuação.
const PAUSE_SENTENCE = 8; // . ! ? … → pausa longa
const PAUSE_CLAUSE = 3; // , ; : → pausa curta
const PAUSE_PARAGRAPH = 6; // \n → respiro de parágrafo

export function buildCharWeights(text: string): CharWeights {
  const n = text.length;
  const cum = new Float64Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    cum[i] = acc;
    acc += 1; // peso base por caractere
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") acc += PAUSE_SENTENCE;
    else if (ch === "," || ch === ";" || ch === ":") acc += PAUSE_CLAUSE;
    else if (ch === "\n") acc += PAUSE_PARAGRAPH;
  }
  cum[n] = acc;
  return { cum, total: acc || 1 };
}

/** Fração de áudio (0..1) → fração de caractere (0..1), respeitando as pausas. */
export function audioFracToCharFrac(w: CharWeights, audioFrac: number): number {
  const n = w.cum.length - 1;
  if (n <= 0) return 0;
  const target = Math.max(0, Math.min(1, audioFrac)) * w.total;
  // Maior i com cum[i] <= target (busca binária).
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (w.cum[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  // Interpola dentro do "peso" do char atual pra suavizar o avanço.
  const base = w.cum[lo];
  const next = lo < n ? w.cum[lo + 1] : w.total;
  const within = next > base ? (target - base) / (next - base) : 0;
  return Math.min(1, (lo + within) / n);
}

/** Fração de caractere (0..1) → fração de áudio (0..1). Inverso do anterior. */
export function charFracToAudioFrac(w: CharWeights, charFrac: number): number {
  const n = w.cum.length - 1;
  if (n <= 0) return 0;
  const pos = Math.max(0, Math.min(1, charFrac)) * n;
  const i = Math.floor(pos);
  const frac = pos - i;
  const base = w.cum[i];
  const next = i < n ? w.cum[i + 1] : w.total;
  const weight = base + frac * (next - base);
  return Math.min(1, weight / w.total);
}
