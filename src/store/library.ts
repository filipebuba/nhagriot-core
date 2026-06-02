// Biblioteca local de livros (persiste em IndexedDB, com migração do localStorage).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createIndexedDbStorage } from "../lib/idbStorage";
import type { LocalBook, ChapterDto } from "../lib/types";

function makeId(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

interface AddBookOpts {
  coverDataUrl?: string | null;
  pageTexts?: string[];
  pageImages?: string[];
  pageTextBoxes?: LocalBook["pageTextBoxes"];
  hasOriginalDoc?: boolean;
}

interface LibraryState {
  books: Record<string, LocalBook>;
  activeBookId: string | null;
  addBook: (
    name: string,
    modeUsed: string,
    chapters: ChapterDto[],
    opts?: AddBookOpts,
  ) => string;
  setActive: (id: string | null) => void;
  setCurrentChapter: (id: string, idx: number) => void;
  setProgress: (
    id: string,
    chapter: number,
    subchunk: number,
    subchunkTotal: number,
  ) => void;
  updateChapter: (id: string, idx: number, text: string) => void;
  // Substitui TODOS os capítulos de uma vez (uma re-narração só). Usado pela
  // limpeza por IA: marca aiCleaned p/ não re-processar/re-pagar.
  replaceChapters: (id: string, chapters: ChapterDto[], aiCleaned?: boolean) => void;
  removeBook: (id: string) => void;
  list: () => LocalBook[];
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      books: {},
      activeBookId: null,

      addBook: (name, modeUsed, chapters, opts = {}) => {
        const id = makeId(name);
        const now = new Date().toISOString();
        const existing = get().books[id];
        const book: LocalBook = {
          id,
          name,
          modeUsed,
          addedAt: existing?.addedAt ?? now,
          lastOpenedAt: now,
          currentChapter: existing?.currentChapter ?? 1,
          currentSubchunk: existing?.currentSubchunk ?? 0,
          currentSubchunkTotal: existing?.currentSubchunkTotal,
          // Preserva a capa antiga se a nova vier null (re-upload sem regenerar)
          coverDataUrl: opts.coverDataUrl ?? existing?.coverDataUrl ?? null,
          pageTexts: opts.pageTexts ?? existing?.pageTexts,
          pageImages: opts.pageImages ?? existing?.pageImages,
          pageTextBoxes: opts.pageTextBoxes ?? existing?.pageTextBoxes,
          hasOriginalDoc: opts.hasOriginalDoc ?? existing?.hasOriginalDoc,
          chapters,
        };
        set({ books: { ...get().books, [id]: book }, activeBookId: id });
        return id;
      },

      setActive: (id) => {
        if (id) {
          const b = get().books[id];
          if (b) {
            set({
              activeBookId: id,
              books: { ...get().books, [id]: { ...b, lastOpenedAt: new Date().toISOString() } },
            });
            return;
          }
        }
        set({ activeBookId: id });
      },

      setCurrentChapter: (id, idx) => {
        const b = get().books[id];
        if (!b) return;
        // Trocar de capítulo zera o subchunk — começa do início do novo
        set({
          books: {
            ...get().books,
            [id]: {
              ...b,
              currentChapter: idx,
              currentSubchunk: 0,
              currentSubchunkTotal: undefined,
              lastOpenedAt: new Date().toISOString(),
            },
          },
        });
      },

      setProgress: (id, chapter, subchunk, subchunkTotal) => {
        const b = get().books[id];
        if (!b) return;
        // Evita escritas redundantes (Zustand re-renderiza listeners a cada set)
        if (
          b.currentChapter === chapter &&
          b.currentSubchunk === subchunk &&
          b.currentSubchunkTotal === subchunkTotal
        ) {
          return;
        }
        set({
          books: {
            ...get().books,
            [id]: {
              ...b,
              currentChapter: chapter,
              currentSubchunk: subchunk,
              currentSubchunkTotal: subchunkTotal,
              lastOpenedAt: new Date().toISOString(),
            },
          },
        });
      },

      updateChapter: (id, idx, text) => {
        const b = get().books[id];
        if (!b) return;
        const newChapters = b.chapters.map((c) =>
          c.index === idx ? { ...c, text, char_count: text.length } : c,
        );
        set({ books: { ...get().books, [id]: { ...b, chapters: newChapters } } });
      },

      replaceChapters: (id, chapters, aiCleaned = false) => {
        const b = get().books[id];
        if (!b) return;
        set({ books: { ...get().books, [id]: { ...b, chapters, aiCleaned } } });
      },

      removeBook: (id) => {
        const rest = { ...get().books };
        delete rest[id];
        set({ books: rest, activeBookId: get().activeBookId === id ? null : get().activeBookId });
      },

      list: () => {
        const arr = Object.values(get().books);
        arr.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
        return arr;
      },
    }),
    {
      name: "audiobook-library",
      storage: createJSONStorage(() => createIndexedDbStorage(window.localStorage)),
    },
  ),
);
