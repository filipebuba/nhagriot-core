// Utilidades de PLN leves, 100% no cliente. Servem ao gerador heurístico do
// Study Pack enquanto a IA de verdade não está plugada. Nada aqui inventa
// conteúdo: trabalha sobre o texto real do documento (frequências, frases,
// trechos). É o que torna a feature útil de imediato e ética (citações reais).

const STOPWORDS = new Set<string>([
  // PT
  "a","o","e","é","de","do","da","dos","das","em","no","na","nos","nas","um","uma","uns","umas",
  "que","com","por","para","pra","como","mas","ou","se","sua","seu","suas","seus","ao","aos","à","às",
  "este","esta","isto","esse","essa","isso","aquele","aquela","aquilo","ele","ela","eles","elas","eu","tu","você","vocês","nós",
  "foi","ser","são","está","estão","tem","têm","há","mais","menos","muito","muita","muitos","muitas","já","não","sim","também","entre","sobre","sem","quando","onde","porque","cada","todo","toda","todos","todas","outro","outra","outros","outras","seu","pelo","pela","pelos","pelas","num","numa","então","assim","ainda","apenas","ser","sua","aqui","ali","lá","seu","etc",
  // EN
  "the","a","an","and","or","but","of","to","in","on","for","with","as","by","at","from","that","this","these","those","is","are","was","were","be","been","being","it","its","he","she","they","we","you","i","not","no","yes","also","more","most","less","than","then","so","such","into","about","over","under","between","which","who","whom","whose","what","when","where","why","how","can","could","would","should","may","might","will","shall","do","does","did","have","has","had","their","his","her","our","your","my",
]);

// Frases genéricas que NÃO são conceitos acadêmicos (bloqueadas).
export const GENERIC_PHRASES = new Set<string>([
  "deste livro","desta obra","deste capítulo","deste capitulo","desta forma","desta maneira",
  "nosso tempo","neste momento","naquele momento","maior parte","última análise","ultima analise",
  "ponto de vista","mesmo tempo","tal forma","cada vez","todo caso","outro lado","primeiro lugar",
  "certa forma","alguns casos","muitos casos","tantas vezes","cada um","cada uma","sendo assim",
  "this book","this chapter","this paper","our time","in fact","this study","the text",
]);

// Termos isolados genéricos demais para virar conceito.
export const GENERIC_TERMS = new Set<string>([
  "livro","capítulo","capitulo","texto","obra","autor","autora","autores","parte","partes","forma",
  "caso","casos","tempo","modo","exemplo","exemplos","vez","vezes","coisa","coisas","mundo","vida",
  "ponto","pontos","lugar","momento","maneira","sentido","fato","fatos","número","numero","página",
  "pagina","leitor","leitura","trecho","seção","secao","tópico","topico","assunto","ideia","ideias",
  "book","chapter","text","author","part","way","case","time","thing","point","page","fact","idea",
]);

export function isGenericPhrase(p: string): boolean {
  if (GENERIC_PHRASES.has(p)) return true;
  const [a, b] = p.split(" ");
  return GENERIC_TERMS.has(a) && GENERIC_TERMS.has(b);
}

// Nomes próprios / categorias (autores, escolas, métodos) — sequências de
// palavras capitalizadas, recorrentes. Reais; não inventados.
export function properNounPhrases(text: string, limit = 6): string[] {
  const re =
    /\b[A-ZÀ-Þ][a-zà-ÿ]{2,}(?:\s+(?:de|da|do|dos|das|e)\s+[A-ZÀ-Þ][a-zà-ÿ]{2,}|\s+[A-ZÀ-Þ][a-zà-ÿ]{2,}){1,2}\b/gu;
  const freq = new Map<string, number>();
  const matches = text.match(re) ?? [];
  for (const m of matches) {
    const key = m.trim();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2) // recorrente → reduz falso-positivo de início de frase
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([p]) => p);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9"“])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-zà-öø-ÿ][a-zà-öø-ÿ-]{2,}/giu);
  if (!matches) return [];
  return matches.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

// Frequência de termos (unigramas).
export function termFrequencies(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of tokenize(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return freq;
}

// Frases-chave (bigramas/trigramas) por frequência — capturam termos compostos
// como "domínio público", "literatura oral", "tráfico atlântico".
export function keyPhrases(text: string, limit = 12): string[] {
  const tokensRaw = text.toLowerCase().match(/[a-zà-öø-ÿ][a-zà-öø-ÿ-]{2,}/giu) ?? [];
  const phraseFreq = new Map<string, number>();
  for (let i = 0; i < tokensRaw.length - 1; i += 1) {
    const a = tokensRaw[i];
    const b = tokensRaw[i + 1];
    if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    const bigram = `${a} ${b}`;
    phraseFreq.set(bigram, (phraseFreq.get(bigram) ?? 0) + 1);
  }
  return [...phraseFreq.entries()]
    .filter(([p, n]) => n >= 2 && !isGenericPhrase(p))
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([p]) => p);
}

// Termos isolados mais salientes (excluindo os que já estão em frases-chave).
export function topTerms(text: string, limit = 10): string[] {
  return [...termFrequencies(text).entries()]
    .filter(([t]) => !GENERIC_TERMS.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

// Capitaliza só a 1ª letra de cada palavra, preservando acentos. (O \b do JS
// trata letras acentuadas como fronteira de palavra e gera "FÁBrica" — por isso
// não usamos regex aqui.)
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Primeira frase do texto que contém o termo — usada para "aterrar" a
// explicação de um conceito numa passagem real do documento.
export function sentenceContaining(sentences: string[], term: string): string | undefined {
  const needle = term.toLowerCase();
  const found = sentences.find((s) => s.toLowerCase().includes(needle));
  if (!found) return undefined;
  return found.length > 320 ? found.slice(0, 300).trim() + "…" : found;
}

// Pontua frases pela densidade de termos salientes — para extrair os trechos
// mais "importantes" (reais) do documento.
export function scoreSentences(sentences: string[], topSet: Set<string>): Array<{ s: string; score: number }> {
  return sentences
    .map((s) => {
      const len = s.length;
      if (len < 60 || len > 360) return { s, score: -1 }; // nem curta demais nem longa demais
      const toks = tokenize(s);
      if (toks.length === 0) return { s, score: -1 };
      let hits = 0;
      for (const t of toks) if (topSet.has(t)) hits += 1;
      // densidade ponderada pelo tamanho ideal (~140 chars)
      const density = hits / Math.sqrt(toks.length);
      const lengthPenalty = 1 - Math.abs(len - 160) / 400;
      return { s, score: density * lengthPenalty };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Procura uma frase que pareça enunciar problema/objetivo/método/conclusão a
// partir de pistas linguísticas. Retorna a frase REAL ou undefined.
export function findCue(sentences: string[], cues: string[]): string | undefined {
  for (const s of sentences) {
    const low = s.toLowerCase();
    if (cues.some((c) => low.includes(c)) && s.length >= 40 && s.length <= 360) {
      return s.length > 320 ? s.slice(0, 300).trim() + "…" : s;
    }
  }
  return undefined;
}
