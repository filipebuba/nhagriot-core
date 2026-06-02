// Divide texto em sub-chunks pra TTS sem travar (cada request ~5-15s no Piper CPU).
// Respeita fronteiras de parágrafo → frase → palavra pra não cortar no meio.

const SENT_SPLIT = /(?<=[.!?…])\s+(?=[A-ZÀ-Ý"'(])/;

function isProblematicChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    code <= 8 ||
    (code >= 11 && code <= 31) ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0xfeff
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(SENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitize(text: string): string {
  // Normaliza Unicode + tira control chars e zero-width
  let t = text.normalize("NFKC");
  t = Array.from(t, (ch) => (isProblematicChar(ch) ? " " : ch)).join("");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function isSpeakable(chunk: string): boolean {
  const c = chunk.trim();
  if (c.length < 3) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(c)) return false;
  // Pelo menos 50% letras/espaços
  let alpha = 0;
  for (const ch of c) if (/[A-Za-zÀ-ÿ\s]/.test(ch)) alpha++;
  return alpha / c.length >= 0.5;
}

// Ramp de tamanhos: os PRIMEIROS chunks são pequenos pra narração começar em
// ~1-2s (Piper CPU leva ~5-10s num chunk de 2000), crescendo até maxChars pra
// eficiência depois (menos overhead por request). Sem isso o 1º chunk é tão
// grande quanto os demais e o usuário espera o pior caso logo na largada.
const RAMP_CHARS = [350, 700, 1300];

function budgetFor(chunkIndex: number, maxChars: number): number {
  return Math.min(maxChars, RAMP_CHARS[chunkIndex] ?? maxChars);
}

/**
 * Divide texto em chunks com tamanho crescente (ramp).
 * Os primeiros saem curtos pra começar a tocar rápido; os seguintes crescem
 * até maxChars (default 2000 ≈ 10-20s de áudio, ~5-10s pra sintetizar).
 * Determinístico: mesma entrada → mesma saída (markers da barra dependem disso).
 */
export function splitIntoSubchunks(text: string, maxChars = 2000): string[] {
  const clean = sanitize(text);
  const paragraphs = clean.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    // Orçamento corrente cresce conforme já emitimos chunks (ramp).
    if (para.length <= budgetFor(chunks.length, maxChars)) {
      chunks.push(para);
      continue;
    }

    let buf = "";
    for (const sent of splitSentences(para)) {
      if (!buf) {
        buf = sent;
      } else if (buf.length + 1 + sent.length <= budgetFor(chunks.length, maxChars)) {
        buf = `${buf} ${sent}`;
      } else {
        chunks.push(buf);
        buf = sent;
      }
      // Frase única gigante: corta por espaço respeitando o orçamento corrente.
      while (buf.length > budgetFor(chunks.length, maxChars)) {
        const budget = budgetFor(chunks.length, maxChars);
        let cut = buf.lastIndexOf(" ", budget);
        if (cut === -1) cut = budget;
        chunks.push(buf.slice(0, cut));
        buf = buf.slice(cut).trimStart();
      }
    }
    if (buf) chunks.push(buf);
  }

  return chunks.filter(isSpeakable).map(ensureTerminalPunct);
}

/**
 * Garante que o chunk termina em pontuação final pra Piper "fechar" a entonação.
 * Sem isso, frases truncadas saem com tom de continuação (entonação errada).
 */
function ensureTerminalPunct(chunk: string): string {
  const trimmed = chunk.trimEnd();
  if (!trimmed) return trimmed;
  const last = trimmed[trimmed.length - 1];
  if (".!?…,;:".includes(last)) return trimmed;
  return trimmed + ".";
}
