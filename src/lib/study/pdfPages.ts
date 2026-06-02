// Extração de texto PÁGINA A PÁGINA com pdf.js (no navegador) — para dar
// referência de página aos trechos do Study Pack, sem PyMuPDF/backend.
// Reusa o mesmo padrão de carregamento do pdf.js do cover.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ChapterDto, OriginalTextBox } from "../types";

const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_PAGES = 1500;
const MAX_PREVIEW_PAGES = 120;
const PREVIEW_WIDTH = 900;
const PREVIEW_QUALITY = 0.68;

export interface PdfOriginalPages {
  texts: string[];
  images: string[];
  boxes: OriginalTextBox[][];
}

// Texto de cada página (índice 0 = página 1). [] se não for PDF ou falhar.
export async function extractPdfPages(file: File): Promise<string[]> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf || file.size > MAX_FILE_BYTES) return [];
  try {
    const [pdfjsLib, workerSrc] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages: string[] = [];
    try {
      const n = Math.min(pdf.numPages, MAX_PAGES);
      for (let i = 1; i <= n; i += 1) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = (content.items as any[])
          .map((it) => (typeof it?.str === "string" ? it.str : ""))
          .join(" ");
        pages.push(text);
        (page as any).cleanup?.();
      }
    } finally {
      await pdf.destroy();
    }
    return pages;
  } catch (err) {
    console.warn("[pdfPages] falha ao extrair páginas:", err);
    return [];
  }
}

// Previews visuais das paginas do PDF para leitura sincronizada no player.
// Limitado para nao transformar livros grandes em centenas de MB no IndexedDB.
export async function renderPdfPageImages(file: File): Promise<string[]> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf || file.size > MAX_FILE_BYTES) return [];
  try {
    const [pdfjsLib, workerSrc] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const images: string[] = [];
    try {
      const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
      for (let i = 1; i <= n; i += 1) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(PREVIEW_WIDTH / base.width, 2);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        images.push(canvas.toDataURL("image/jpeg", PREVIEW_QUALITY));
        (page as any).cleanup?.();
      }
    } finally {
      await pdf.destroy();
    }
    return images;
  } catch (err) {
    console.warn("[pdfPages] falha ao renderizar paginas:", err);
    return [];
  }
}

export async function extractPdfOriginalPages(file: File): Promise<PdfOriginalPages> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf || file.size > MAX_FILE_BYTES) return { texts: [], images: [], boxes: [] };
  try {
    const [pdfjsLib, workerSrc] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const texts: string[] = [];
    const images: string[] = [];
    const boxes: OriginalTextBox[][] = [];
    try {
      const n = Math.min(pdf.numPages, MAX_PAGES);
      for (let i = 1; i <= n; i += 1) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(PREVIEW_WIDTH / base.width, 2);
        const viewport = page.getViewport({ scale });
        const shouldPreview = i <= MAX_PREVIEW_PAGES;
        const canvas = shouldPreview ? document.createElement("canvas") : null;
        const ctx = canvas?.getContext("2d") ?? null;
        if (canvas && ctx) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          images.push(canvas.toDataURL("image/jpeg", PREVIEW_QUALITY));
        }

        const content = await page.getTextContent();
        const pageBoxes: OriginalTextBox[] = [];
        let cursor = 0;
        for (const item of content.items as any[]) {
          const text = typeof item?.str === "string" ? item.str : "";
          if (!text.trim()) {
            cursor += text.length + 1;
            continue;
          }
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]));
          const width = Math.max(1, (item.width || text.length * fontHeight * 0.45) * scale);
          const x = tx[4];
          const y = tx[5] - fontHeight;
          if (canvas) {
            pageBoxes.push({
              text,
              start: cursor,
              end: cursor + text.length,
              x: clamp01(x / canvas.width),
              y: clamp01(y / canvas.height),
              w: clamp01(width / canvas.width),
              h: clamp01((fontHeight * 1.15) / canvas.height),
            });
          }
          cursor += text.length + 1;
        }
        texts.push(
          (content.items as any[])
            .map((it) => (typeof it?.str === "string" ? it.str : ""))
            .join(" "),
        );
        if (shouldPreview) boxes.push(pageBoxes);
        (page as any).cleanup?.();
      }
    } finally {
      await pdf.destroy();
    }
    return { texts, images, boxes };
  } catch (err) {
    console.warn("[pdfPages] falha ao extrair original:", err);
    return { texts: [], images: [], boxes: [] };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Agrupa páginas em "capítulos" por tamanho (~8000 chars), título por faixa de
// páginas. TOC utilizável pra qualquer PDF, sem detecção frágil de cabeçalho.
function pagesToChapters(pages: string[]): ChapterDto[] {
  const TARGET = 8000;
  const chapters: ChapterDto[] = [];
  let buf = "";
  let startPage = 1;
  for (let i = 0; i < pages.length; i += 1) {
    buf += (buf ? " " : "") + pages[i];
    const isLast = i === pages.length - 1;
    if (buf.length >= TARGET || isLast) {
      const endPage = i + 1;
      const text = buf.trim();
      if (text) {
        chapters.push({
          index: chapters.length + 1,
          title: startPage === endPage ? `Página ${startPage}` : `Páginas ${startPage}–${endPage}`,
          text,
          char_count: text.length,
        });
      }
      buf = "";
      startPage = endPage + 1;
    }
  }
  return chapters;
}

// Heurística: as páginas têm camada de texto REAL (vs PDF 100% escaneado)?
// Exige ≥200 chars no total e média ≥20 chars/página — evita tratar ruído de
// OCR/numeração solta como se fosse o texto da obra.
export function pagesHaveText(pageTexts: string[]): boolean {
  if (!pageTexts.length) return false;
  const total = pageTexts.reduce((s, p) => s + p.trim().length, 0);
  return total >= 200 && total / pageTexts.length >= 20;
}

// Monta capítulos a partir de textos JÁ extraídos por página (sem re-parsear o
// PDF). Use quando já chamou extractPdfOriginalPages/extractPdfPages. [] se as
// páginas não têm texto real (escaneado) → chamador cai no OCR do backend.
export function chaptersFromPageTexts(pageTexts: string[]): ChapterDto[] {
  return pagesHaveText(pageTexts) ? pagesToChapters(pageTexts) : [];
}

// Extrai capítulos de um PDF COM camada de texto, no NAVEGADOR (sem HF Space) —
// resolve livros grandes (centenas/milhares de páginas) sem timeout. Retorna
// null se: não for PDF, for PDF escaneado (sem texto → precisa OCR no backend),
// ou falhar. Aí o chamador cai no backend.
export async function extractPdfChaptersClient(
  file: File,
): Promise<{ chapters: ChapterDto[]; pageTexts: string[] } | null> {
  const pages = await extractPdfPages(file);
  const chapters = chaptersFromPageTexts(pages);
  return chapters.length ? { chapters, pageTexts: pages } : null;
}

function normForMatch(s: string): string {
  return s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
}

// Pré-normaliza as páginas uma vez (reuso em vários trechos).
export function normalizePages(pageTexts: string[]): string[] {
  return pageTexts.map(normForMatch);
}

// Acha a página (1-based) que contém o trecho. undefined se não localizar.
export function locateExcerptPage(excerptText: string, normalizedPages: string[]): number | undefined {
  if (!normalizedPages.length) return undefined;
  const needle = normForMatch(excerptText).slice(0, 60);
  if (needle.length < 12) return undefined;
  for (let i = 0; i < normalizedPages.length; i += 1) {
    if (normalizedPages[i].includes(needle)) return i + 1;
  }
  return undefined;
}
