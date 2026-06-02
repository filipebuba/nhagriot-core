// Persiste config do backend e preferências do player no localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Engine } from "../lib/types";

// O core open-source NÃO embute nenhum backend. Cada app define o seu próprio
// endpoint de TTS via VITE_API_BASE_URL (fica vazio por padrão).
const DEFAULT_BACKEND_URL = import.meta.env.VITE_API_BASE_URL || "";

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  engine: Engine;             // "native" (free) | "piper" (pro)
  defaultVoice: string;       // path .onnx do Piper (tier pro)
  nativeVoiceURI: string;     // voiceURI da voz do navegador (tier free)
  speakerWav: string | null;  // path em data/refs/ pra clonagem XTTS (legado)
  maxChars: number;
  lengthScale: number;        // 1.0 = velocidade nativa, >1 = mais lento e pausado (afeta síntese, invalida cache)
  playbackRate: number;       // 1.0 = normal. Aplica-se ao <audio>, instantâneo, NÃO invalida cache.
  setBaseUrl: (u: string) => void;
  setApiKey: (k: string) => void;
  setEngine: (e: Engine) => void;
  setDefaultVoice: (v: string) => void;
  setNativeVoiceURI: (v: string) => void;
  setSpeakerWav: (s: string | null) => void;
  setMaxChars: (n: number) => void;
  setLengthScale: (n: number) => void;
  setPlaybackRate: (n: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: DEFAULT_BACKEND_URL,
      apiKey: "",
      engine: "native",         // free por padrão (voz do navegador)
      defaultVoice: "",
      nativeVoiceURI: "",
      speakerWav: null,
      maxChars: 350,
      lengthScale: 1.0,
      playbackRate: 1.0,
      setBaseUrl: (baseUrl) => set({ baseUrl: baseUrl.trim().replace(/\/+$/, "") }),
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setEngine: (engine) => set({ engine }),
      setDefaultVoice: (defaultVoice) => set({ defaultVoice }),
      setNativeVoiceURI: (nativeVoiceURI) => set({ nativeVoiceURI }),
      setSpeakerWav: (speakerWav) => set({ speakerWav }),
      setMaxChars: (maxChars) => set({ maxChars }),
      setLengthScale: (lengthScale) => set({ lengthScale: Math.max(0.7, Math.min(1.5, lengthScale)) }),
      setPlaybackRate: (playbackRate) => set({ playbackRate: Math.max(0.5, Math.min(3.0, playbackRate)) }),
    }),
    {
      name: "audiobook-settings",
      // O env VITE_API_BASE_URL é a fonte de verdade do deployment. Quando
      // definido, vence qualquer baseUrl persistido no localStorage (que podia
      // ter sobrado de um teste local antigo, ex http://127.0.0.1:7860). Sem
      // isso, um valor velho no localStorage sequestra o backend pra sempre.
      // O "Modo desenvolvedor" ainda permite trocar a URL em runtime.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const envUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
        return {
          ...current,
          ...p,
          baseUrl: envUrl || p.baseUrl || current.baseUrl,
        };
      },
    },
  ),
);
