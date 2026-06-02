// Exportação do Study Pack: Markdown (.md), Word (.doc via HTML, abre no Word e
// no Google Docs) e PDF (janela de impressão → "Salvar como PDF"). Sem libs
// novas — tudo nativo do navegador.
import type { Flashcard, StudyPack } from "./types";

const NOTICE =
  "Material de APOIO ao estudo gerado pelo Nhagriot. Os trechos citados pertencem ao documento original; conceitos e análises interpretativas devem ser revisados pelo estudante. Você é responsável por ter o direito de usar o documento enviado.";

export function studyPackToMarkdown(pack: StudyPack): string {
  const s = pack.summary;
  const L: string[] = [];
  L.push(`# Pacote de Estudos — ${s.title}`);
  if (s.author) L.push(`**Autor:** ${s.author}`);
  L.push(`*Modo acadêmico:* ${pack.mode} · *Palavras:* ${pack.wordCount.toLocaleString("pt-BR")}`);
  L.push("");

  L.push("## Resumo acadêmico");
  if (s.abstract) {
    L.push(s.abstract);
    L.push("");
  }
  if (s.simpleSummary) {
    L.push(`**Em palavras simples:** ${s.simpleSummary}`);
    L.push("");
  }
  L.push(`- **Tema central:** ${s.theme}`);
  L.push(`- **Problema:** ${s.problem}`);
  L.push(`- **Objetivo:** ${s.objective}`);
  L.push(`- **Argumento principal:** ${s.argument}`);
  if (s.methodology) L.push(`- **Metodologia:** ${s.methodology}`);
  L.push(`- **Conclusão:** ${s.conclusion}`);
  L.push(`- **Relevância:** ${s.relevance}`);
  if (s.keywords?.length) L.push(`- **Palavras-chave:** ${s.keywords.join(", ")}`);
  if (s.authorsCited?.length)
    L.push(
      `- **Autores/obras citados:** ${s.authorsCited
        .map((a) => (a.note ? `${a.name} (${a.note})` : a.name))
        .join("; ")}`,
    );
  L.push("");

  L.push("## Conceitos-chave");
  for (const c of pack.concepts) L.push(`- **${c.term}** — ${c.explanation}`);
  L.push("");

  if (pack.flashcards?.length) {
    L.push("## Flashcards de revisão");
    pack.flashcards.forEach((f, i) => L.push(`${i + 1}. **${f.front}** — ${f.back}`));
    L.push("");
  }

  L.push("## Trechos importantes");
  for (const e of pack.excerpts) {
    L.push(`> ${e.text}`);
    if (e.reference) L.push(`> — *${e.reference}*`);
    L.push("");
  }

  for (const f of pack.fichamentos) {
    if (f.type === "resumo") {
      L.push("## Fichamento de resumo");
      L.push(`**Referência:** ${f.reference}`);
      if (f.summary) L.push(`\n${f.summary}`);
      if (f.mainIdeas?.length) {
        L.push("\n**Ideias principais:**");
        f.mainIdeas.forEach((i) => L.push(`- ${i}`));
      }
      if (f.keyConcepts?.length) L.push(`\n**Conceitos:** ${f.keyConcepts.join(", ")}`);
      L.push("");
    } else if (f.type === "citacao") {
      L.push("## Fichamento de citação");
      L.push(`**Referência:** ${f.reference}`);
      for (const e of f.citations ?? []) {
        L.push(`\n> ${e.text}`);
        if (e.reference) L.push(`> — *${e.reference}*`);
        if (e.use) L.push(`> _Uso:_ ${e.use}`);
      }
      L.push("");
    } else {
      L.push("## Fichamento crítico");
      L.push(`**Referência:** ${f.reference}`);
      if (f.thesis) L.push(`\n**Tese do autor:** ${f.thesis}`);
      if (f.strongArguments?.length) {
        L.push("\n**Argumentos mais fortes:**");
        f.strongArguments.forEach((a) => L.push(`- ${a}`));
      }
      if (f.limitations?.length) {
        L.push("\n**Limitações a avaliar:**");
        f.limitations.forEach((a) => L.push(`- ${a}`));
      }
      if (f.critiques?.length) {
        L.push("\n**Possíveis críticas:**");
        f.critiques.forEach((a) => L.push(`- ${a}`));
      }
      if (f.relations?.length) L.push(`\n**Relações:** ${f.relations.join(", ")}`);
      L.push("");
    }
  }

  L.push("## Perguntas de estudo");
  for (const g of pack.questions) {
    L.push(`\n### ${g.label}`);
    g.questions.forEach((q, i) => L.push(`${i + 1}. ${q}`));
  }
  L.push("");

  L.push(`## Plano de estudo (${pack.plan.lengthLabel})`);
  for (const d of pack.plan.days) {
    L.push(`\n**${d.title}** (${d.minutes} min)`);
    if (d.chapters.length) L.push(`Seções: ${d.chapters.join("; ")}`);
    d.tasks.forEach((t) => L.push(`- ${t}`));
  }
  L.push("");

  L.push("---");
  L.push(`_${NOTICE}_`);
  return L.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML estilizado, usado tanto para Word (.doc) quanto para impressão/PDF.
export function studyPackToHtml(pack: StudyPack): string {
  const md = studyPackToMarkdown(pack);
  // Conversão mínima de markdown → HTML (cabeçalhos, listas, citações, negrito).
  const lines = md.split("\n");
  const html: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^# /.test(line)) {
      closeList();
      html.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (/^## /.test(line)) {
      closeList();
      html.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (/^### /.test(line)) {
      closeList();
      html.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (/^> /.test(line)) {
      closeList();
      html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    } else if (line === "---") {
      closeList();
      html.push("<hr/>");
    } else if (line === "") {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();

  function inline(t: string): string {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>");
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    pack.summary.title,
  )} — Pacote de Estudos</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1f1a13;max-width:720px;margin:32px auto;padding:0 20px;line-height:1.55}
    h1{font-size:24px;border-bottom:2px solid #ff6a2a;padding-bottom:8px}
    h2{font-size:18px;color:#bb4419;margin-top:28px}
    h3{font-size:15px;margin-top:18px}
    blockquote{border-left:3px solid #d8b25e;margin:8px 0;padding:4px 14px;color:#444;background:#faf6ee}
    ul{margin:6px 0 6px 18px}li{margin:3px 0}
    hr{border:none;border-top:1px solid #ccc;margin:24px 0}
    em{color:#6b6256}
  </style></head><body>${html.join("\n")}</body></html>`;
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

function safeName(title: string): string {
  return title.replace(/[^\w\dÀ-ÿ -]/g, "").trim().slice(0, 60) || "study-pack";
}

export function exportMarkdown(pack: StudyPack) {
  download(
    new Blob([studyPackToMarkdown(pack)], { type: "text/markdown;charset=utf-8" }),
    `${safeName(pack.summary.title)}.md`,
  );
}

// Flashcards em TSV (frente<TAB>verso, um por linha) — formato que o Anki e o
// Quizlet importam diretamente. Tabs/quebras viram espaço pra não estourar a
// separação de colunas/cartões.
export function exportFlashcards(cards: Flashcard[], title: string) {
  const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const tsv = cards.map((f) => `${cell(f.front)}\t${cell(f.back)}`).join("\n");
  download(
    new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" }),
    `${safeName(title)}-flashcards.txt`,
  );
}

// Word .docx REAL (OOXML), editável nativamente. Carregado sob demanda em ./docx.
export async function exportDoc(pack: StudyPack): Promise<void> {
  const { exportStudyPackDocx } = await import("./docx");
  await exportStudyPackDocx(pack);
}

// PDF de verdade via pdfmake (capa, TOC, rodapé, sem artefatos de impressão).
// Carregado sob demanda em ./pdf.
export async function exportPdf(pack: StudyPack): Promise<void> {
  const { exportStudyPackPdf } = await import("./pdf");
  await exportStudyPackPdf(pack);
}
