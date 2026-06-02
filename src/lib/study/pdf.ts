// Geração de PDF de verdade (pdfmake) — sem janela de impressão, sem artefatos
// "about:blank"/cabeçalho de data. Capa, sumário (TOC), tipografia limpa,
// números de página, rodapé Nhagriot e disclaimer.
//
// pdfmake é carregado sob demanda (dynamic import) pra não pesar o bundle inicial.
import type { StudyPack } from "./types";

const GRAY = "#9a8f80";
const INK = "#241c12";
const BRAND = "#ff6a2a";
const BRAND_DEEP = "#bb4419";
const GOLD = "#a9802f";
const NOT_ID = "Não identificado";

/* eslint-disable @typescript-eslint/no-explicit-any */
let _pdfMake: any = null;
async function getPdfMake(): Promise<any> {
  if (_pdfMake) return _pdfMake;
  const pdfMakeMod: any = await import("pdfmake/build/pdfmake");
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  const vfsMod: any = await import("pdfmake/build/vfs_fonts");
  const vfs = vfsMod.default ?? vfsMod;
  if (typeof pdfMake.addVirtualFileSystem === "function") {
    pdfMake.addVirtualFileSystem(vfs);
  } else {
    pdfMake.vfs = vfs?.pdfMake?.vfs ?? vfs;
  }
  _pdfMake = pdfMake;
  return pdfMake;
}

function safeName(title: string): string {
  return title.replace(/[^\w\dÀ-ÿ -]/g, "").trim().slice(0, 60) || "study-pack";
}

function h1(text: string): any {
  return { text, style: "h1", tocItem: true, margin: [0, 18, 0, 8] };
}
function field(label: string, value: string): any {
  return { text: [{ text: `${label}: `, bold: true, color: INK }, value], margin: [0, 0, 0, 6] };
}

function buildDoc(pack: StudyPack): any {
  const meta = pack.meta;
  const s = pack.summary;
  const title = meta?.title ?? s.title;
  const author = meta?.author && meta.author !== NOT_ID ? meta.author : s.author ?? "";

  const content: any[] = [];

  // ── Capa ──
  content.push(
    { text: "NHAGRIOT", style: "brand", margin: [0, 150, 0, 0] },
    { text: "PACOTE DE ESTUDOS", style: "brandSub" },
    { canvas: [{ type: "line", x1: 0, y1: 8, x2: 80, y2: 8, lineWidth: 2, lineColor: GOLD }], margin: [0, 6, 0, 0] },
    { text: title, style: "coverTitle", margin: [0, 30, 0, 0] },
    author ? { text: author, style: "coverAuthor" } : {},
    {
      text: [meta?.docType, meta?.year, meta?.language].filter((x) => x && x !== NOT_ID).join(" · "),
      style: "coverMeta",
    },
    { text: "Material de apoio ao estudo", style: "coverNote", margin: [0, 46, 0, 0], pageBreak: "after" },
  );

  // ── Sumário ──
  content.push({ toc: { title: { text: "Sumário", style: "h1", margin: [0, 0, 0, 8] } } });

  // ── Identificação ──
  const firstH1 = h1("Identificação");
  firstH1.pageBreak = "before";
  content.push(firstH1);
  if (meta) {
    content.push({
      table: {
        widths: ["auto", "*"],
        body: [
          ["Título", meta.title],
          ["Autor", meta.author],
          ["Ano", meta.year],
          ["Tipo", meta.docType],
          ["Idioma", meta.language],
          ["Palavras", meta.wordCount.toLocaleString("pt-BR")],
          ["Escuta estimada", `${meta.listeningMinutes} min`],
        ].map(([k, v]) => [
          { text: k, bold: true, color: INK, margin: [0, 2, 8, 2] },
          { text: v, color: "#5e564a", margin: [0, 2, 0, 2] },
        ]),
      },
      layout: "noBorders",
    });
  }

  // ── Resumo acadêmico ──
  content.push(h1("Resumo acadêmico"));
  if (s.abstract) content.push({ text: s.abstract, alignment: "justify", margin: [0, 0, 0, 8] });
  content.push(field("Tema central", s.theme));
  content.push(field("Problema", s.problem));
  content.push(field("Objetivo", s.objective));
  content.push(field("Argumento principal", s.argument));
  content.push(field("Metodologia", s.methodology ?? "Não declarada explicitamente"));
  content.push(field("Conclusão", s.conclusion));
  content.push(field("Relevância", s.relevance));
  if (s.keywords?.length) content.push(field("Palavras-chave", s.keywords.join(", ")));
  if (s.authorsCited?.length)
    content.push(
      field(
        "Autores/obras citados",
        s.authorsCited.map((a) => (a.note ? `${a.name} (${a.note})` : a.name)).join("; "),
      ),
    );

  // ── Conceitos-chave ──
  content.push(h1("Conceitos-chave"));
  content.push({
    ul: pack.concepts.map((c) => ({ text: [{ text: c.term, bold: true, color: GOLD }, ` — ${c.explanation}`] })),
    margin: [0, 0, 0, 4],
  });

  // ── Flashcards de revisão ──
  if (pack.flashcards?.length) {
    content.push(h1("Flashcards de revisão"));
    content.push({
      ol: pack.flashcards.map((f) => ({ text: [{ text: `${f.front} `, bold: true, color: GOLD }, `— ${f.back}`] })),
      margin: [0, 0, 0, 4],
    });
  }

  // ── Trechos importantes ──
  if (pack.excerpts.length) {
    content.push(h1("Trechos importantes"));
    for (const e of pack.excerpts) {
      content.push({ text: `“${e.text}”`, style: "quote", margin: [14, 0, 0, 2] });
      if (e.reference) content.push({ text: `— ${e.reference}`, style: "small", margin: [14, 0, 0, 8] });
    }
  }

  // ── Fichamentos ──
  content.push(h1("Fichamentos"));
  for (const f of pack.fichamentos) {
    content.push({
      text: f.type === "resumo" ? "Fichamento de resumo" : f.type === "citacao" ? "Fichamento de citação" : "Fichamento crítico",
      style: "h2",
    });
    content.push({ text: f.reference, style: "small", margin: [0, 0, 0, 4] });
    if (f.type === "resumo") {
      if (f.summary) content.push({ text: f.summary, margin: [0, 0, 0, 4] });
      if (f.mainIdeas?.length) content.push({ ul: f.mainIdeas, margin: [0, 0, 0, 4] });
      if (f.keyConcepts?.length) content.push(field("Conceitos", f.keyConcepts.join(", ")));
    } else if (f.type === "citacao") {
      for (const e of f.citations ?? []) {
        content.push({ text: `“${e.text}”`, style: "quote", margin: [14, 0, 0, 2] });
        if (e.reference) content.push({ text: `— ${e.reference}`, style: "small", margin: [14, 0, 0, 6] });
      }
    } else {
      if (f.thesis) content.push(field("Tese do autor", f.thesis));
      if (f.strongArguments?.length) {
        content.push({ text: "Argumentos mais fortes", bold: true, margin: [0, 2, 0, 2] });
        content.push({ ul: f.strongArguments, margin: [0, 0, 0, 4] });
      }
      if (f.limitations?.length) {
        content.push({ text: "Limitações a avaliar", bold: true, margin: [0, 2, 0, 2] });
        content.push({ ul: f.limitations, margin: [0, 0, 0, 4] });
      }
      if (f.relations?.length) content.push(field("Relações", f.relations.join(", ")));
    }
  }

  // ── Perguntas ──
  content.push(h1("Perguntas de estudo"));
  for (const g of pack.questions) {
    content.push({ text: g.label, style: "h2" });
    content.push({ ol: g.questions, margin: [0, 0, 0, 6] });
  }

  // ── Plano ──
  content.push(h1(`Plano de estudo (${pack.plan.lengthLabel})`));
  for (const d of pack.plan.days) {
    content.push({ text: `${d.title} · ${d.minutes} min`, style: "h2" });
    if (d.chapters.length) content.push({ text: `Seções: ${d.chapters.join("; ")}`, style: "small", margin: [0, 0, 0, 2] });
    content.push({ ul: d.tasks, margin: [0, 0, 0, 4] });
  }

  // ── Disclaimer ──
  content.push({
    text: "Material de apoio ao estudo gerado pelo Nhagriot — acessibilidade, organização e compreensão. As citações pertencem ao documento original; conceitos e análises interpretativas devem ser revisados pelo estudante. Você é responsável por ter o direito de usar o documento. O Nhagriot não reivindica direitos sobre o conteúdo enviado.",
    style: "disclaimer",
    margin: [0, 24, 0, 0],
  });

  return {
    info: { title: `${title} — Pacote de Estudos`, author: author || "Nhagriot", creator: "Nhagriot" },
    pageSize: "A4",
    pageMargins: [54, 56, 54, 64],
    footer(currentPage: number, pageCount: number) {
      if (currentPage === 1) return null; // sem rodapé na capa
      return {
        margin: [54, 14, 54, 0],
        columns: [
          { text: "Nhagriot · Pacote de Estudos", fontSize: 8, color: GRAY },
          { text: `${currentPage} / ${pageCount}`, alignment: "right", fontSize: 8, color: GRAY },
        ],
      };
    },
    content,
    styles: {
      brand: { fontSize: 24, bold: true, color: BRAND },
      brandSub: { fontSize: 11, color: GRAY, characterSpacing: 3, margin: [0, 2, 0, 0] },
      coverTitle: { fontSize: 26, bold: true, color: INK },
      coverAuthor: { fontSize: 13, color: "#6b6256", margin: [0, 8, 0, 0] },
      coverMeta: { fontSize: 10, color: GRAY, margin: [0, 4, 0, 0] },
      coverNote: { fontSize: 10, italics: true, color: GRAY },
      h1: { fontSize: 15, bold: true, color: BRAND_DEEP },
      h2: { fontSize: 12, bold: true, color: INK, margin: [0, 10, 0, 4] },
      quote: { italics: true, color: "#3a3328" },
      small: { fontSize: 9, color: GRAY },
      disclaimer: { fontSize: 8.5, italics: true, color: GRAY },
    },
    defaultStyle: { fontSize: 10.5, lineHeight: 1.35, color: "#2b2418" },
  };
}

export async function exportStudyPackPdf(pack: StudyPack): Promise<void> {
  const pdfMake = await getPdfMake();
  const title = pack.meta?.title ?? pack.summary.title;
  pdfMake.createPdf(buildDoc(pack)).download(`${safeName(title)}.pdf`);
}
