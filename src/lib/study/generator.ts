// Gerador do Study Pack. Interface única e SWAPPÁVEL: hoje roda o gerador
// heurístico local (mock inteligente, aterrado no texto real); amanhã basta
// trocar por um gerador remoto (LLM no backend) que devolva o mesmo StudyPack.
//
// ÉTICA: trechos e citações são SEMPRE reais (extraídos do documento). Campos
// interpretativos (problema, tese, críticas) vêm como ANDAIME rotulado — apoio
// ao estudo, nunca o trabalho pronto. Quando a IA entrar, ela enriquece esses
// campos sem mudar a UI.

import type { LocalBook, ChapterDto } from "../types";
import {
  type AcademicMode,
  type AcademicSummary,
  type Concept,
  type DocumentMeta,
  type Excerpt,
  type Fichamento,
  type Flashcard,
  type GenStep,
  type StudyPack,
  type StudyPlan,
  type StudyPlanDay,
  type StudyQuestionGroup,
  StudyError,
} from "./types";
import {
  findCue,
  keyPhrases,
  properNounPhrases,
  scoreSentences,
  sentenceContaining,
  splitSentences,
  titleCase,
  topTerms,
  wordCount,
} from "./nlp";
import { extractMeta, normalizeText, NOT_ID } from "./normalize";
import { normalizePages, locateExcerptPage } from "./pdfPages";

export interface GenerateOptions {
  mode: AcademicMode;
  onStep?: (step: GenStep) => void;
}

export interface StudyGenerator {
  generate(book: LocalBook, opts: GenerateOptions): Promise<StudyPack>;
}

const MIN_WORDS = 80;
const tick = (ms = 380) => new Promise<void>((r) => setTimeout(r, ms));

export const MODE_RELEVANCE: Record<AcademicMode, string> = {
  class: "Use como base para acompanhar a aula: domine os conceitos-chave e os trechos centrais antes do encontro.",
  tcc: "Serve para fundamentar o referencial teórico do TCC. Cite os trechos com a referência completa e conecte os conceitos ao seu problema de pesquisa.",
  dissertation: "Útil na revisão de literatura da dissertação: posicione o autor no debate e relacione com outras fontes do seu corpus.",
  thesis: "Para a tese, vá além do resumo: discuta criticamente os limites do texto e como ele sustenta (ou desafia) a sua hipótese.",
  article: "No artigo, use para compor o estado da arte e justificar lacunas que a sua contribuição preenche.",
  research: "No projeto de pesquisa, aproveite para delimitar problema, objetivos e método dialogando com este texto.",
  exam: "Para a prova, foque nos conceitos-chave e nas perguntas de revisão; releia os trechos marcados.",
  defense: "Para a defesa, antecipe as perguntas da banca: domine a tese do autor, seus limites e como ele se relaciona à sua pesquisa.",
};

function buildSummary(
  book: LocalBook,
  mode: AcademicMode,
  meta: DocumentMeta,
  sentences: string[],
  phrases: string[],
  terms: string[],
  lastChapterText: string,
): AcademicSummary {
  const theme =
    phrases.slice(0, 3).map(titleCase).join("; ") ||
    terms.slice(0, 4).map(titleCase).join(", ") ||
    "Tema a definir a partir da leitura";

  const problem =
    findCue(sentences, ["problema", "questão", "pergunta", "research question", "problem"]) ??
    `A partir da leitura, o problema central gira em torno de ${theme.toLowerCase()}. (Andaime — refine com o texto.)`;

  const objective =
    findCue(sentences, ["objetivo", "este trabalho", "este texto", "this paper", "this study", "pretende", "busca", "visa"]) ??
    `O texto trata de ${theme.toLowerCase()}, organizado em ${book.chapters.length} ${
      book.chapters.length === 1 ? "seção" : "seções"
    }. (Andaime — confirme o objetivo declarado.)`;

  const argument =
    findCue(sentences, ["argumenta", "defende", "sustenta", "argues", "claims", "tese", "thesis"]) ??
    `O fio condutor articula ${terms.slice(0, 3).map(titleCase).join(", ")}. (Andaime — verifique o argumento principal.)`;

  const methodology = findCue(sentences, [
    "metodologia",
    "método",
    "qualitativ",
    "quantitativ",
    "entrevista",
    "questionário",
    "amostra",
    "corpus",
    "método",
    "methodolog",
    "method",
    "survey",
  ]);

  const lastSentences = splitSentences(lastChapterText);
  const conclusion =
    findCue(sentences, ["conclui", "conclusão", "portanto", "conclusion", "in conclusion", "concludes"]) ??
    (lastSentences.length
      ? lastSentences.slice(-2).join(" ").slice(0, 320)
      : "Conclusão a sintetizar a partir das últimas seções. (Andaime.)");

  return {
    title: meta.title,
    author: meta.author !== NOT_ID ? meta.author : undefined,
    theme,
    // Resumo corrido (andaime): costura objetivo + argumento + conclusão num
    // parágrafo. A IA substitui por um abstract de verdade quando disponível.
    abstract: [objective, argument, conclusion].filter(Boolean).join(" ").slice(0, 900),
    keywords: terms.slice(0, 6).map(titleCase),
    // authorsCited fica indefinido no motor local: não afirmamos que um nome
    // próprio é "autor citado" sem a IA confirmar no texto.
    problem,
    objective,
    argument,
    methodology,
    conclusion,
    relevance: MODE_RELEVANCE[mode],
  };
}

// Flashcards de revisão a partir dos conceitos ATERRADOS (explicação veio do
// texto). Frente = pergunta sobre o termo; verso = a explicação encontrada.
function buildFlashcards(concepts: Concept[]): Flashcard[] {
  return concepts
    .filter((c) => c.grounded && c.explanation && c.explanation.trim().length > 12)
    .slice(0, 10)
    .map((c) => ({ front: `O que significa “${c.term}”?`, back: c.explanation.trim() }));
}

function buildConcepts(
  sentences: string[],
  properNouns: string[],
  phrases: string[],
  terms: string[],
): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  // displayCase: nomes próprios preservam a caixa original (Paulo Freire);
  // termos comuns recebem title case leve.
  const push = (raw: string, keepCase: boolean) => {
    const term = keepCase ? raw.trim() : titleCase(raw.trim());
    const key = term.toLowerCase();
    if (seen.has(key) || term.length < 3) return;
    seen.add(key);
    const grounded = sentenceContaining(sentences, raw);
    out.push({
      term,
      explanation:
        grounded ?? "Categoria recorrente no documento. (Explicação a refinar com a leitura.)",
      grounded: !!grounded,
    });
  };
  properNouns.forEach((p) => push(p, true)); // autores / escolas / categorias
  phrases.forEach((p) => push(p, false));
  terms.forEach((t) => push(t, false));
  return out.slice(0, 10);
}

function buildExcerpts(chapters: ChapterDto[], topSet: Set<string>, pageTexts?: string[]): Excerpt[] {
  const out: Excerpt[] = [];
  // Páginas (pdf.js) normalizadas uma vez para localizar cada trecho.
  const normPages = pageTexts && pageTexts.length ? normalizePages(pageTexts) : null;
  for (const ch of chapters) {
    const sents = splitSentences(normalizeText(ch.text));
    const scored = scoreSentences(sents, topSet).slice(0, 2);
    for (const { s } of scored) {
      let reference = ch.title;
      let page: number | undefined;
      if (normPages) {
        page = locateExcerptPage(s, normPages);
        // Página exata quando localizada; senão "localização aproximada"
        // (nunca inventamos uma página).
        reference = page ? `p. ${page}` : "localização aproximada";
      }
      out.push({
        text: s,
        reference,
        page,
        comment: "Trecho de alta densidade temática — confira o contexto antes de citar.",
        use: "Pode embasar a fundamentação teórica, com a referência completa.",
      });
    }
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}

function buildFichamentos(
  summary: AcademicSummary,
  concepts: Concept[],
  excerpts: Excerpt[],
  mainIdeas: string[],
  mode: AcademicMode,
): Fichamento[] {
  const reference = summary.author
    ? `${summary.author.toUpperCase()}. ${summary.title}. (local, editora e ano a completar).`
    : `${summary.title.toUpperCase()}. (autor, local, editora e ano a completar).`;

  const resumo: Fichamento = {
    type: "resumo",
    reference,
    summary: `${summary.objective} ${summary.argument}`,
    mainIdeas,
    keyConcepts: concepts.slice(0, 6).map((c) => c.term),
    academicUse: [MODE_RELEVANCE[mode]],
  };

  const citacao: Fichamento = {
    type: "citacao",
    reference,
    citations: excerpts,
  };

  const critico: Fichamento = {
    type: "critico",
    reference,
    thesis: summary.argument,
    strongArguments: mainIdeas.slice(0, 3),
    limitations: [
      "O texto explicita claramente o método? Avalie a robustez metodológica.",
      "As fontes/dados sustentam as afirmações centrais?",
      "Há vieses ou contexto (histórico, cultural) que limitem as conclusões?",
    ],
    critiques: [
      "Que contra-argumento a literatura recente ofereceria?",
      "O autor generaliza além do que os dados permitem?",
    ],
    relations: concepts.slice(0, 5).map((c) => c.term),
  };

  return [resumo, citacao, critico];
}

function buildQuestions(
  summary: AcademicSummary,
  concepts: Concept[],
  mode: AcademicMode,
): StudyQuestionGroup[] {
  const c = concepts.map((x) => x.term);
  const theme = summary.theme.split(";")[0]?.trim() || summary.title;
  const pair = c.length >= 2 ? [c[0], c[1]] : [c[0] ?? theme, theme];

  const comprehension = [
    `Qual é o tema central do documento?`,
    c[0] && `O que o texto entende por “${c[0]}”?`,
    c[1] && `Como o autor relaciona “${pair[0]}” e “${pair[1]}”?`,
    `Qual é o objetivo declarado (ou implícito) do texto?`,
  ].filter(Boolean) as string[];

  const discussion = [
    `Que implicações “${theme}” tem para o contexto de ${modeContext(mode)}?`,
    c[2] && `Em que medida “${c[2]}” ainda é relevante hoje?`,
    `Você concorda com o argumento principal? Por quê?`,
  ].filter(Boolean) as string[];

  const exam = [
    c[0] && `Explique “${c[0]}” com suas palavras, com base no texto.`,
    c.length >= 2 && `Diferencie “${pair[0]}” de “${pair[1]}”.`,
    `Resuma a conclusão do texto em até três frases.`,
  ].filter(Boolean) as string[];

  const defense = [
    `Como você defenderia a relevância de “${theme}” para a sua pesquisa?`,
    `Quais as limitações metodológicas do texto e como você as contornou?`,
    c[0] && `Que críticas a banca poderia levantar sobre “${c[0]}”? Como respondê-las?`,
    `Como este texto se posiciona frente às demais fontes do seu corpus?`,
  ].filter(Boolean) as string[];

  return [
    { kind: "comprehension", label: "Compreensão", questions: comprehension },
    { kind: "discussion", label: "Discussão em aula", questions: discussion },
    { kind: "exam", label: "Preparação para prova", questions: exam },
    { kind: "defense", label: "Defesa / banca", questions: defense },
  ];
}

function modeContext(mode: AcademicMode): string {
  switch (mode) {
    case "tcc":
      return "um TCC";
    case "dissertation":
      return "uma dissertação";
    case "thesis":
      return "uma tese";
    case "article":
      return "um artigo acadêmico";
    case "research":
      return "um projeto de pesquisa";
    case "exam":
      return "uma avaliação";
    case "defense":
      return "uma defesa";
    default:
      return "a sua disciplina";
  }
}

function buildPlan(chapters: ChapterDto[], totalWords: number): StudyPlan {
  const dayCount = totalWords < 4000 ? 3 : totalWords < 12000 ? 5 : 7;
  const perDay = Math.max(1, Math.ceil(chapters.length / dayCount));
  const days: StudyPlanDay[] = [];
  let totalMinutes = 0;

  for (let d = 0; d < dayCount; d += 1) {
    const slice = chapters.slice(d * perDay, (d + 1) * perDay);
    const words = slice.reduce((s, c) => s + wordCount(c.text), 0);
    const minutes = Math.max(10, Math.round(words / 130)); // ~130 palavras/min ouvindo
    if (slice.length) totalMinutes += minutes;
    days.push({
      day: d + 1,
      title: slice.length
        ? `Dia ${d + 1} — ler e ouvir`
        : `Dia ${d + 1} — revisão`,
      chapters: slice.map((c) => c.title),
      minutes: slice.length ? minutes : 15,
      tasks: slice.length
        ? [
            `Ouvir ${slice.length === 1 ? "a seção" : `as ${slice.length} seções`} do dia`,
            "Anotar 2–3 conceitos-chave",
            "Responder as perguntas de compreensão",
          ]
        : ["Revisar os fichamentos", "Responder perguntas de prova", "Marcar dúvidas para a aula"],
    });
  }
  return {
    lengthLabel: `${dayCount} dias`,
    totalMinutes,
    days,
  };
}

// Reference ABNT (a completar) compartilhada entre fichamentos.
export function buildReference(meta: DocumentMeta): string {
  return meta.author !== NOT_ID
    ? `${meta.author.toUpperCase()}. ${meta.title}. (local, editora e ano a completar).`
    : `${meta.title.toUpperCase()}. (autor, local, editora e ano a completar).`;
}

// ── Partes determinísticas (aterradas no texto real) ──
// Compartilhadas pelo gerador local E pelo remoto (LLM): metadados, trechos
// reais (citações nunca inventadas), plano de estudo, e os insumos de análise.
export interface DeterministicParts {
  fullText: string;
  words: number;
  meta: DocumentMeta;
  sentences: string[];
  properNouns: string[];
  phrases: string[];
  terms: string[];
  topSet: Set<string>;
  excerpts: Excerpt[];
  mainIdeas: string[];
  plan: StudyPlan;
}

export function deterministicParts(book: LocalBook): DeterministicParts {
  const fullText = normalizeText(book.chapters.map((c) => c.text).join("\n\n"));
  const words = wordCount(fullText);
  if (words < MIN_WORDS) {
    throw new StudyError(
      "O documento tem texto curto demais (ou o OCR não reconheceu bem as páginas). Reenvie um PDF com texto selecionável, melhore a foto, ou cole o texto manualmente.",
    );
  }
  const meta = extractMeta(book, fullText);
  const sentences = splitSentences(fullText);
  const properNouns = properNounPhrases(fullText, 6);
  const phrases = keyPhrases(fullText, 12);
  const terms = topTerms(fullText, 12);
  const topSet = new Set<string>([...terms, ...phrases.flatMap((p) => p.split(" "))]);
  const excerpts = buildExcerpts(book.chapters, topSet, book.pageTexts);
  const mainIdeas = scoreSentences(sentences, topSet).slice(0, 5).map((x) => x.s);
  const plan = buildPlan(book.chapters, words);
  return { fullText, words, meta, sentences, properNouns, phrases, terms, topSet, excerpts, mainIdeas, plan };
}

// ─────────────────────────── Gerador local ──────────────────────────────

export const localGenerator: StudyGenerator = {
  async generate(book, { mode, onStep }) {
    onStep?.("extracting");
    await tick(300);
    const D = deterministicParts(book); // lança StudyError se texto for curto

    onStep?.("analyzing");
    await tick(420);
    const concepts = buildConcepts(D.sentences, D.properNouns, D.phrases, D.terms);

    onStep?.("summary");
    await tick(420);
    const lastChapter = book.chapters[book.chapters.length - 1];
    const summary = buildSummary(book, mode, D.meta, D.sentences, D.phrases, D.terms, normalizeText(lastChapter?.text ?? ""));

    onStep?.("fichamento");
    await tick(420);
    const fichamentos = buildFichamentos(summary, concepts, D.excerpts, D.mainIdeas, mode);

    onStep?.("questions");
    await tick(360);
    const questions = buildQuestions(summary, concepts, mode);

    onStep?.("ready");

    return {
      bookId: book.id,
      mode,
      generator: "local",
      generatedAt: new Date().toISOString(),
      wordCount: D.words,
      meta: D.meta,
      summary,
      concepts,
      flashcards: buildFlashcards(concepts),
      fichamentos,
      questions,
      excerpts: D.excerpts,
      plan: D.plan,
      thin: D.words < 400,
    };
  },
};
