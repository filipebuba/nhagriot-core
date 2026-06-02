// Normalização de texto e extração de metadados — tudo no cliente, sem inventar.
// Atende às melhorias do pipeline: NFC, juntar quebras de linha no meio de frase,
// título correto a partir do conteúdo (preservando acentos), e metadados com
// "Não identificado" quando não houver evidência.
import type { LocalBook } from "../types";
import type { DocumentMeta } from "./types";

export const NOT_ID = "Não identificado";

// Normaliza Unicode (NFC), corrige hifenização de quebra de linha e junta
// quebras no meio de frase, preservando parágrafos (linha dupla).
export function normalizeText(raw: string): string {
  let t = (raw ?? "").normalize("NFC").replace(/\r\n/g, "\n").replace(/ /g, " ");
  // "pala-\nvra" -> "palavra"
  t = t.replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/giu, "$1$2");
  // quebra no meio de frase (linha não termina em pontuação e a próxima começa
  // minúscula/aspas) -> espaço. Não mexe em quebras de parágrafo.
  t = t.replace(/([^.!?:;)\]"”»\n])\n(?=[a-zà-ÿ0-9"“(])/giu, "$1 ");
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// Conectivos que ficam minúsculos no título (PT/EN), exceto na 1ª palavra.
const TITLE_LOWER = new Set([
  "de","do","da","dos","das","e","o","a","os","as","em","no","na","nos","nas",
  "ao","aos","à","às","um","uma","para","por","com","sem","sob","ou","the","of",
  "and","in","on","for","to","a","an",
]);

function capFirst(w: string): string {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

// Title case ciente do português — NÃO usar em texto vindo do documento (que já
// tem o caixa correto); só para títulos derivados do nome de arquivo.
export function titleCasePt(s: string): string {
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i > 0 && TITLE_LOWER.has(w) ? w : capFirst(w))).join(" ");
}

// Tokens de versão/revisão a remover do FIM do nome do arquivo.
const VERSION_WORDS = new Set([
  "revisto","revisado","revisao","revisão","revisada","final","rascunho","draft",
  "copy","copia","cópia","versao","versão","editado","edited","atualizado","atualizada",
  "ptbr","pt","en","fr","es","br","us","uk","docx","doc","pdf","txt","epub","limpo","ok","novo","nova",
]);
function isVersionToken(w: string): boolean {
  const low = w.toLowerCase();
  if (VERSION_WORDS.has(low)) return true;
  if (/^v\d+$/i.test(w)) return true; // v34
  if (/^rev\d*$/i.test(w)) return true; // rev2
  return false;
}

// "O_Algoritmo_do_Principe_revisto" -> "O Algoritmo do Principe"
// (acento que falta no nome do arquivo NÃO é inventado — para isso preferimos o
//  título do corpo do documento, ver detectTitleFromText).
export function cleanFilenameTitle(name: string): string {
  let t = name.replace(/\.[^/.]+$/, ""); // extensão
  t = t.replace(/[_]+/g, " ").replace(/\s*-\s*/g, " - ");
  const words = t.split(/\s+/).filter(Boolean);
  // remove sufixos de versão do fim
  while (words.length > 1 && isVersionToken(words[words.length - 1])) words.pop();
  // remove " - " órfão no fim
  while (words.length > 1 && words[words.length - 1] === "-") words.pop();
  return titleCasePt(words.join(" "));
}

// Procura um título plausível nas primeiras linhas do documento (preserva caixa
// e acentos do original). Retorna undefined se nada convincente.
export function detectTitleFromText(book: LocalBook): string | undefined {
  const first = book.chapters[0]?.text ?? "";
  const lines = first
    .normalize("NFC")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const line of lines) {
    if (line.length < 6 || line.length > 90) continue;
    if (/[.;:]$/.test(line)) continue; // frases comuns terminam com pontuação
    if (/^(cap[ií]tulo|chapter|sum[áa]rio|[ií]ndice|introdu)/i.test(line)) continue;
    const letters = (line.match(/[a-zà-ÿ]/giu) ?? []).length;
    if (letters < line.length * 0.5) continue; // muita numeração/símbolo
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 14) continue;
    return line;
  }
  return undefined;
}

function detectAuthor(head: string): string {
  const m = head.match(
    /\b(?:por|by|autor[ae]?:?)\s+([A-ZÀ-Þ][\wÀ-ÿ.'-]+(?:\s+[A-ZÀ-Þ][\wÀ-ÿ.'-]+){1,3})/u,
  );
  return m ? m[1].trim() : NOT_ID;
}

function detectYear(text: string): string {
  const m = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? m[1] : NOT_ID;
}

function detectDocType(head: string): string {
  const map: Array<[RegExp, string]> = [
    [/\btese\b/i, "Tese"],
    [/\bdisserta[çc][ãa]o\b/i, "Dissertação"],
    [/\bartigo\b/i, "Artigo"],
    [/\bmonografia|tcc\b/i, "TCC/Monografia"],
    [/\brelat[óo]rio\b/i, "Relatório"],
    [/\bcap[íi]tulo\b/i, "Capítulo de livro"],
    [/\bromance\b/i, "Romance"],
    [/\bconto[s]?\b/i, "Contos"],
    [/\bmanual\b/i, "Manual"],
    [/\bpoema|poesia\b/i, "Poesia"],
  ];
  for (const [re, label] of map) if (re.test(head)) return label;
  return NOT_ID;
}

const PT_MARKERS = ["de", "que", "não", "uma", "para", "com", "como", "mas", "ção", "são"];
const EN_MARKERS = ["the", "and", "that", "with", "from", "this", "which", "have", "tion", "ing"];
function detectLanguage(sample: string): string {
  const low = ` ${sample.toLowerCase()} `;
  let pt = 0;
  let en = 0;
  for (const w of PT_MARKERS) pt += (low.match(new RegExp(`\\b${w}|${w}\\b`, "g")) ?? []).length;
  for (const w of EN_MARKERS) en += (low.match(new RegExp(`\\b${w}|${w}\\b`, "g")) ?? []).length;
  if (pt === 0 && en === 0) return NOT_ID;
  return pt >= en ? "Português" : "Inglês";
}

export function extractMeta(book: LocalBook, normalizedText: string): DocumentMeta {
  const head = normalizedText.slice(0, 3000);
  const tail = normalizedText.slice(-1500);
  const wordCount = (normalizedText.match(/\S+/g) ?? []).length;
  return {
    title: detectTitleFromText(book) ?? cleanFilenameTitle(book.name),
    author: detectAuthor(head),
    year: detectYear(head) !== NOT_ID ? detectYear(head) : detectYear(tail),
    docType: detectDocType(head),
    language: detectLanguage(head),
    wordCount,
    listeningMinutes: Math.max(1, Math.round(wordCount / 130)),
  };
}
