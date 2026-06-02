// Tipos espelhados da REST API do audiobook-pessoal (audiobook/api.py).

export interface HealthResponse {
  ok: boolean;
  xtts_enabled: boolean;
  auth_required: boolean;
}

export interface PiperVoice {
  path: string;
  name: string;
}

export interface CloneRef {
  path: string;
  name: string;
  duration_s: number;
}

export interface KokoroVoice {
  id: string;     // ex: "pf_dora"
  name: string;   // ex: "Dora (feminina)"
  lang: string;   // ex: "pt-br"
}

export interface VoicesResponse {
  piper: PiperVoice[];
  kokoro?: KokoroVoice[];
  xtts_builtin: string[];
  xtts_enabled: boolean;
  clonage_refs: CloneRef[];
}

export interface ChapterDto {
  index: number;
  title: string;
  text: string;
  char_count: number;
}

export interface ExtractResponse {
  mode_used: string;
  chapter_count: number;
  total_chars: number;
  chapters: ChapterDto[];
  full_text?: string;
}

export interface OcrResponse {
  text: string;
  char_count: number;
  handwritten: boolean;
}

export interface OriginalTextBox {
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CloneVoiceResponse {
  saved_path: string;
  name: string;
  duration_s: number;
}

// Modelo local: livro persistido no localStorage
export interface LocalBook {
  id: string;                    // hash do nome
  name: string;
  modeUsed: string;
  addedAt: string;
  lastOpenedAt: string;
  currentChapter: number;
  // Posição exata dentro do capítulo: índice do subchunk de áudio onde
  // o usuário pausou. ~30s de precisão. Permite retomar de onde parou.
  currentSubchunk?: number;
  // Total de subchunks do capítulo atual no momento em que `currentSubchunk`
  // foi gravado. Usado pra mostrar progresso granular sem recomputar.
  currentSubchunkTotal?: number;
  // Texto dos capítulos já foi limpo pela IA (one-time, cacheado p/ não re-pagar).
  aiCleaned?: boolean;
  // Thumbnail da primeira página do arquivo original (PDF) ou da imagem.
  // Data URL JPEG ~50–150KB. Ausente em EPUB/DOCX/TXT (cai no fallback).
  coverDataUrl?: string | null;
  // Texto por página (índice 0 = página 1), capturado via pdf.js no upload de
  // PDFs. Usado pelo Study Pack para referenciar a página de cada trecho.
  pageTexts?: string[];
  // Previews JPEG das paginas originais (PDF/imagens), guardados localmente
  // para o player mostrar o documento como foi enviado.
  pageImages?: string[];
  // Caixas normalizadas (0..1) da camada de texto do PDF, por pagina.
  // Permite desenhar highlight sobre a pagina original durante a narracao.
  pageTextBoxes?: OriginalTextBox[][];
  // True quando há um arquivo original renderizável (ex.: .docx) guardado no
  // cache IndexedDB (originalFileCache), keyed por id. Usado pelo Player para
  // oferecer o modo "Original" mesmo sem imagens de página (caso de Word).
  hasOriginalDoc?: boolean;
  chapters: ChapterDto[];
}

export type ExtractMode =
  | "auto"
  | "pdf_native"
  | "pdf_print_ocr"
  | "pdf_hand_ocr"
  | "epub"
  | "image_print"
  | "image_hand"
  | "text";

// "native" = voz do navegador (Web Speech), tier FREE, roda no dispositivo.
// "piper"  = TTS neural no servidor, tier PRO (rápido).
// "kokoro" = TTS premium no servidor, tier PRO+ (qualidade de audiolivro).
export type Engine = "native" | "piper" | "kokoro";
