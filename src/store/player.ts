import { create } from "zustand";

export interface GlobalPlayerSnapshot {
  bookId: string | null;
  bookName: string;
  chapterTitle: string;
  coverDataUrl?: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  /** Pausa curta por buffer (underrun) — exibida como "Sincronizando…". */
  isBuffering: boolean;
  isPending: boolean;
  progressPct: number;
  remainingSec: number;
  playPause: (() => void) | null;
  seekBack: (() => void) | null;
  seekForward: (() => void) | null;
}

interface PlayerState extends GlobalPlayerSnapshot {
  setSnapshot: (snapshot: GlobalPlayerSnapshot) => void;
  clearSnapshot: () => void;
}

const emptySnapshot: GlobalPlayerSnapshot = {
  bookId: null,
  bookName: "",
  chapterTitle: "",
  coverDataUrl: null,
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
  isPending: false,
  progressPct: 0,
  remainingSec: 0,
  playPause: null,
  seekBack: null,
  seekForward: null,
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ...emptySnapshot,
  setSnapshot: (snapshot) => set(snapshot),
  clearSnapshot: () => set(emptySnapshot),
}));
