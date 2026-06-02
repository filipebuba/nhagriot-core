// Meta diária de leitura/escuta + progresso. Persiste no localStorage.
//
// Config: quais dias da semana, quantos minutos/dia, lembrete on/off + hora.
// Progresso: segundos ouvidos hoje (rola à meia-noite local), streak de dias
// em que a meta foi batida.
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Data local YYYY-MM-DD (não UTC, pra o "dia" bater com o fuso do usuário). */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayStr(today: string): string {
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

interface GoalsState {
  // ── Config ──
  configured: boolean;
  daysOfWeek: number[]; // 0=Dom .. 6=Sáb
  minutesPerDay: number;
  reminderEnabled: boolean;
  reminderTime: string; // "HH:MM" 24h

  // ── Progresso ──
  progressDate: string; // YYYY-MM-DD do secondsToday
  secondsToday: number;
  streak: number;
  lastMetDate: string | null;
  // Evita disparar o lembrete mais de uma vez no mesmo dia
  reminderFiredDate: string | null;

  // ── Ações ──
  saveConfig: (cfg: {
    daysOfWeek: number[];
    minutesPerDay: number;
    reminderEnabled: boolean;
    reminderTime: string;
  }) => void;
  addSeconds: (n: number) => void;
  markReminderFired: () => void;
  resetToday: () => void;
}

export const useGoalsStore = create<GoalsState>()(
  persist(
    (set, get) => ({
      configured: false,
      daysOfWeek: [1, 2, 3, 4, 5], // seg–sex por padrão
      minutesPerDay: 30,
      reminderEnabled: false,
      reminderTime: "19:00",

      progressDate: localDateStr(),
      secondsToday: 0,
      streak: 0,
      lastMetDate: null,
      reminderFiredDate: null,

      saveConfig: (cfg) =>
        set({
          configured: true,
          daysOfWeek: [...cfg.daysOfWeek].sort((a, b) => a - b),
          minutesPerDay: Math.max(5, Math.min(240, Math.round(cfg.minutesPerDay))),
          reminderEnabled: cfg.reminderEnabled,
          reminderTime: cfg.reminderTime,
        }),

      addSeconds: (n) => {
        const today = localDateStr();
        const s = get();
        // Rola o dia se mudou
        let secondsToday = s.progressDate === today ? s.secondsToday : 0;
        secondsToday += n;

        const goalSec = s.minutesPerDay * 60;
        let { streak, lastMetDate } = s;
        // Bateu a meta hoje (e ainda não tinha contado)
        if (secondsToday >= goalSec && lastMetDate !== today) {
          streak = lastMetDate === yesterdayStr(today) ? streak + 1 : 1;
          lastMetDate = today;
        }
        set({ progressDate: today, secondsToday, streak, lastMetDate });
      },

      markReminderFired: () => set({ reminderFiredDate: localDateStr() }),

      resetToday: () => set({ progressDate: localDateStr(), secondsToday: 0 }),
    }),
    { name: "nhagriot-goals" },
  ),
);

// ── Helpers derivados (fora do store, puros) ──

/** Minutos estimados por livro (pra converter meta → "livros/mês"). */
export const MINUTES_PER_BOOK = 400;

export function booksPerMonth(minutesPerDay: number, daysOfWeek: number[]): number {
  const perWeek = minutesPerDay * Math.max(1, daysOfWeek.length);
  const perMonth = perWeek * 4.345; // semanas por mês
  return perMonth / MINUTES_PER_BOOK;
}

/** Hoje é um dia agendado da meta? */
export function isScheduledToday(daysOfWeek: number[]): boolean {
  return daysOfWeek.includes(new Date().getDay());
}
