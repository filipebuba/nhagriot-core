// Uso de armazenamento do dispositivo (Storage API). Mostra quanto o Nhagriot
// ocupa no aparelho (IndexedDB de áudio/livros + Cache Storage do PWA) e permite
// pedir armazenamento PERSISTENTE — importante para usuários com pouco espaço
// (ex.: Guiné-Bissau): sem isso, o navegador pode apagar o áudio baixado quando
// o espaço fica baixo. Tudo best-effort: navegadores antigos não suportam.

export interface StorageInfo {
  supported: boolean;
  usage: number; // bytes usados pela origem
  quota: number; // bytes disponíveis (estimativa do navegador)
  persisted: boolean; // true = navegador não vai despejar os dados
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.estimate === "function";
  if (!supported) return { supported: false, usage: 0, quota: 0, persisted: false };
  try {
    const est = await navigator.storage.estimate();
    let persisted = false;
    try {
      if (typeof navigator.storage.persisted === "function") {
        persisted = await navigator.storage.persisted();
      }
    } catch {
      /* persisted() indisponível — segue como false */
    }
    return { supported: true, usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  } catch {
    return { supported: false, usage: 0, quota: 0, persisted: false };
  }
}

/** Pede ao navegador para NÃO despejar os dados desta origem. Retorna o estado final. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}
