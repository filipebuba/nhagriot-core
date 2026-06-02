// Geração de .docx REAL (OOXML) com a lib `docx` — editável nativamente no Word
// e no Google Docs (ao contrário do truque antigo de HTML disfarçado de .doc).
// Carregada sob demanda (dynamic import) pra não pesar o bundle inicial.
import type { StudyPack } from "./types";

function safeName(title: string): string {
  return title.replace(/[^\w\dÀ-ÿ -]/g, "").trim().slice(0, 60) || "pacote-de-estudos";
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportStudyPackDocx(pack: StudyPack): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");

  const s = pack.summary;
  const meta = pack.meta;
  const children: InstanceType<typeof Paragraph>[] = [];

  const h1 = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
  const h2 = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 80 } });
  const para = (t: string) => new Paragraph({ children: [new TextRun(t)], spacing: { after: 80 } });
  const small = (t: string) => new Paragraph({ children: [new TextRun({ text: t, italics: true, size: 18, color: "777777" })], spacing: { after: 80 } });
  const field = (label: string, value: string) =>
    new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)], spacing: { after: 80 } });
  const bullet = (t: string) => new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 40 } });
  const conceptBullet = (term: string, exp: string) =>
    new Paragraph({ children: [new TextRun({ text: `${term} — `, bold: true }), new TextRun(exp)], bullet: { level: 0 }, spacing: { after: 40 } });
  const quote = (t: string) =>
    new Paragraph({ children: [new TextRun({ text: t, italics: true })], indent: { left: 360 }, spacing: { after: 40 } });

  // Título + metadados
  children.push(new Paragraph({ text: s.title, heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ children: [new TextRun({ text: "Pacote de Estudos · Nhagriot", color: "BB4419" })], alignment: AlignmentType.LEFT, spacing: { after: 120 } }));
  if (meta) {
    children.push(field("Autor", meta.author));
    children.push(
      small(
        `Ano: ${meta.year}  ·  Tipo: ${meta.docType}  ·  Idioma: ${meta.language}  ·  ${meta.wordCount.toLocaleString("pt-BR")} palavras  ·  ~${meta.listeningMinutes} min de escuta`,
      ),
    );
  }

  // Resumo
  children.push(h1("Resumo acadêmico"));
  if (s.abstract) children.push(para(s.abstract));
  children.push(field("Tema central", s.theme));
  children.push(field("Problema", s.problem));
  children.push(field("Objetivo", s.objective));
  children.push(field("Argumento principal", s.argument));
  children.push(field("Metodologia", s.methodology ?? "Não declarada explicitamente"));
  children.push(field("Conclusão", s.conclusion));
  children.push(field("Relevância", s.relevance));
  if (s.keywords?.length) children.push(field("Palavras-chave", s.keywords.join(", ")));
  if (s.authorsCited?.length)
    children.push(
      field(
        "Autores/obras citados",
        s.authorsCited.map((a) => (a.note ? `${a.name} (${a.note})` : a.name)).join("; "),
      ),
    );

  // Conceitos
  children.push(h1("Conceitos-chave"));
  for (const c of pack.concepts) children.push(conceptBullet(c.term, c.explanation));

  // Flashcards
  if (pack.flashcards?.length) {
    children.push(h1("Flashcards de revisão"));
    for (const f of pack.flashcards) children.push(conceptBullet(f.front, f.back));
  }

  // Trechos
  if (pack.excerpts.length) {
    children.push(h1("Trechos importantes"));
    for (const e of pack.excerpts) {
      children.push(quote(`"${e.text}"`));
      if (e.reference) children.push(small(`— ${e.reference}`));
    }
  }

  // Fichamentos
  children.push(h1("Fichamentos"));
  for (const f of pack.fichamentos) {
    children.push(h2(f.type === "resumo" ? "Fichamento de resumo" : f.type === "citacao" ? "Fichamento de citação" : "Fichamento crítico"));
    children.push(small(`Referência: ${f.reference}`));
    if (f.type === "resumo") {
      if (f.summary) children.push(para(f.summary));
      if (f.mainIdeas?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Ideias principais", bold: true })], spacing: { after: 40 } }));
        f.mainIdeas.forEach((i) => children.push(bullet(i)));
      }
      if (f.keyConcepts?.length) children.push(field("Conceitos", f.keyConcepts.join(", ")));
    } else if (f.type === "citacao") {
      for (const e of f.citations ?? []) {
        children.push(quote(`"${e.text}"`));
        if (e.reference) children.push(small(`— ${e.reference}`));
      }
    } else {
      if (f.thesis) children.push(field("Tese do autor", f.thesis));
      if (f.strongArguments?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Argumentos mais fortes", bold: true })], spacing: { after: 40 } }));
        f.strongArguments.forEach((a) => children.push(bullet(a)));
      }
      if (f.limitations?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Limitações a avaliar", bold: true })], spacing: { after: 40 } }));
        f.limitations.forEach((a) => children.push(bullet(a)));
      }
      if (f.relations?.length) children.push(field("Relações", f.relations.join(", ")));
    }
  }

  // Perguntas
  children.push(h1("Perguntas de estudo"));
  for (const g of pack.questions) {
    children.push(h2(g.label));
    g.questions.forEach((q, i) => children.push(para(`${i + 1}. ${q}`)));
  }

  // Plano
  children.push(h1(`Plano de estudo (${pack.plan.lengthLabel})`));
  for (const d of pack.plan.days) {
    children.push(h2(`${d.title} · ${d.minutes} min`));
    if (d.chapters.length) children.push(small(`Seções: ${d.chapters.join("; ")}`));
    d.tasks.forEach((t) => children.push(bullet(t)));
  }

  // Disclaimer
  children.push(
    small(
      "Material de apoio ao estudo gerado pelo Nhagriot — acessibilidade, organização e compreensão. As citações pertencem ao documento original; conceitos e análises devem ser revisados pelo estudante. Você é responsável por ter o direito de usar o documento.",
    ),
  );

  const doc = new Document({
    creator: "Nhagriot",
    title: `${s.title} — Pacote de Estudos`,
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  download(blob, `${safeName(s.title)}.docx`);
}
