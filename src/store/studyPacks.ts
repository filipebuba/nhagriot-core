// Estado do Study Pack por documento (LocalBook): o pack gerado e o modo
// acadêmico escolhido. O DESBLOQUEIO (compras/plano) NÃO mora aqui — é resolvido
// pelo sistema central de direitos (useEntitlements + billing store).
// Persistido em IndexedDB (packs guardam bastante texto).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createIndexedDbStorage } from "../lib/idbStorage";
import type { StudyPack, AcademicMode } from "../lib/study/types";

interface StudyState {
  packs: Record<string, StudyPack>; // por bookId
  modeByBook: Record<string, AcademicMode>;

  setPack: (pack: StudyPack) => void;
  removePack: (bookId: string) => void;
  setMode: (bookId: string, mode: AcademicMode) => void;
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set) => ({
      packs: {},
      modeByBook: {},

      setPack: (pack) => set((s) => ({ packs: { ...s.packs, [pack.bookId]: pack } })),
      removePack: (bookId) =>
        set((s) => {
          const packs = { ...s.packs };
          delete packs[bookId];
          return { packs };
        }),
      setMode: (bookId, mode) => set((s) => ({ modeByBook: { ...s.modeByBook, [bookId]: mode } })),
    }),
    {
      name: "nhagriot-study",
      storage: createJSONStorage(() => createIndexedDbStorage(window.localStorage)),
    },
  ),
);
