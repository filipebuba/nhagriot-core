// Nhagriot Study Pack — tipos do "pacote de estudo" acadêmico gerado a partir
// de um documento já enviado (LocalBook com capítulos de texto).
//
// Filosofia: APOIO ao estudo, não substituição do trabalho do aluno. Tudo que
// é citação/trecho é REAL (extraído do texto). O que exige interpretação
// profunda (problema de pesquisa, crítica) vem como ANDAIME rotulado, para o
// estudante refinar — até a IA de verdade estar plugada (mesma interface).

export type AcademicMode =
  | "class" // leitura de aula
  | "tcc"
  | "dissertation"
  | "thesis"
  | "article" // artigo acadêmico
  | "research" // projeto de pesquisa
  | "exam" // preparação para prova
  | "defense"; // preparação para banca/defesa

export interface AcademicModeDef {
  id: AcademicMode;
  label: string;
  blurb: string;
}

export const ACADEMIC_MODES: AcademicModeDef[] = [
  { id: "class", label: "Leitura de aula", blurb: "Compreender e acompanhar a disciplina" },
  { id: "tcc", label: "TCC", blurb: "Fundamentar a monografia" },
  { id: "dissertation", label: "Dissertação", blurb: "Mestrado: revisão e análise" },
  { id: "thesis", label: "Tese", blurb: "Doutorado: profundidade e crítica" },
  { id: "article", label: "Artigo acadêmico", blurb: "Publicação e estado da arte" },
  { id: "research", label: "Projeto de pesquisa", blurb: "Problema, objetivos e método" },
  { id: "exam", label: "Prova", blurb: "Memorização e revisão rápida" },
  { id: "defense", label: "Defesa / banca", blurb: "Antecipar perguntas e críticas" },
];

export interface DocumentMeta {
  title: string;
  author: string; // ou "Não identificado"
  year: string; // ou "Não identificado"
  docType: string; // ou "Não identificado"
  language: string; // "Português" | "Inglês" | "Não identificado"
  wordCount: number;
  listeningMinutes: number;
}

export interface Concept {
  term: string;
  explanation: string; // grounded: frase do próprio texto quando possível
  grounded: boolean; // true = veio do texto; false = andaime
}

export interface Excerpt {
  text: string; // trecho REAL do documento (nunca inventado)
  reference?: string; // "p. N", capítulo/seção, ou "localização aproximada"
  page?: number; // número da página quando localizado (pdf.js)
  comment?: string; // comentário (andaime)
  use?: string; // uso possível na escrita acadêmica
}

export interface CitedAuthor {
  name: string; // autor/obra EXPLICITAMENTE mencionado no texto (nunca inventado)
  note?: string; // o que é / em que contexto aparece no documento
}

export interface AcademicSummary {
  title: string;
  author?: string;
  theme: string;
  abstract?: string; // resumo corrido em registro acadêmico (1-2 parágrafos)
  simpleSummary?: string; // explicação em linguagem simples (crianças/iniciantes/acessibilidade)
  keywords?: string[]; // palavras-chave, estilo abstract
  authorsCited?: CitedAuthor[]; // autores/obras citados NO texto (aterrado)
  problem: string;
  objective: string;
  argument: string;
  methodology?: string;
  conclusion: string;
  relevance: string; // adapta-se ao modo acadêmico
}

// Flashcard de revisão: frente (pergunta/termo) e verso (resposta curta),
// aterrado no conteúdo do documento. Ótimo para o modo "prova".
export interface Flashcard {
  front: string;
  back: string;
}

export type FichamentoType = "resumo" | "citacao" | "critico";

export interface Fichamento {
  type: FichamentoType;
  reference: string; // referência (ABNT a completar)
  // resumo
  summary?: string;
  mainIdeas?: string[];
  keyConcepts?: string[];
  academicUse?: string[];
  // citação
  citations?: Excerpt[];
  // crítico
  thesis?: string;
  strongArguments?: string[];
  limitations?: string[];
  critiques?: string[];
  relations?: string[];
}

export type QuestionKind = "comprehension" | "discussion" | "exam" | "defense";

export interface StudyQuestionGroup {
  kind: QuestionKind;
  label: string;
  questions: string[];
}

export interface StudyPlanDay {
  day: number;
  title: string;
  chapters: string[];
  minutes: number;
  tasks: string[];
}

export interface StudyPlan {
  lengthLabel: string; // "3 dias" | "5 dias" | "7 dias"
  totalMinutes: number;
  days: StudyPlanDay[];
}

export interface StudyPack {
  bookId: string;
  mode: AcademicMode;
  generator: "local" | "ai";
  generatedAt: string;
  wordCount: number;
  meta?: DocumentMeta;
  summary: AcademicSummary;
  concepts: Concept[];
  flashcards: Flashcard[];
  fichamentos: Fichamento[];
  questions: StudyQuestionGroup[];
  excerpts: Excerpt[];
  plan: StudyPlan;
  /** true quando o texto era curto demais e parte do conteúdo é limitada. */
  thin?: boolean;
  aiError?: string;
}

// Passos de geração (estados de carregamento).
export type GenStep =
  | "extracting" // lendo o texto do documento
  | "analyzing" // analisando (frequências, conceitos, trechos)
  | "summary" // montando o resumo acadêmico
  | "fichamento" // montando fichamentos
  | "questions" // gerando perguntas e plano
  | "ready";

export const GEN_STEP_LABEL: Record<GenStep, string> = {
  extracting: "Extraindo o texto do documento…",
  analyzing: "Analisando o documento…",
  summary: "Gerando o resumo acadêmico…",
  fichamento: "Montando os fichamentos…",
  questions: "Criando perguntas e plano de estudo…",
  ready: "Pronto!",
};

export class StudyError extends Error {}
