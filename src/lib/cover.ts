// Gera thumbnail da primeira página do arquivo enviado.
// PDF: render via pdf.js (lazy-loaded). Imagem: redimensiona o próprio bitmap.
// Demais formatos (EPUB/DOCX/TXT) retornam null — UI cai em fallback "capa serif".

const MAX_WIDTH = 600;
const JPEG_QUALITY = 0.72;
const MAX_FILE_BYTES = 80 * 1024 * 1024; // 80 MB — PDFs maiores que isso ficam sem capa

export async function generateCover(file: File): Promise<string | null> {
  if (file.size > MAX_FILE_BYTES) return null;

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return generatePdfCover(file);

  if (file.type.startsWith("image/")) return generateImageCover(file);

  return null;
}

async function generatePdfCover(file: File): Promise<string | null> {
  try {
    // pdfjs-dist é ~600KB minificado, só carrega na hora do primeiro upload PDF
    const [pdfjsLib, workerSrc] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    try {
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_WIDTH / baseViewport.width, 2);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    } finally {
      await pdf.destroy();
    }
  } catch (err) {
    console.warn("[cover] pdf render failed:", err);
    return null;
  }
}

async function generateImageCover(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(MAX_WIDTH / img.width, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
