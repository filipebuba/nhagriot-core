const SW_URL = "/sw.js";
const SW_SCOPE = "/";
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const RELOAD_KEY = "nhagriot:last-sw-reload";

function requestSkipWaiting(worker: ServiceWorker | null): void {
  worker?.postMessage({ type: "SKIP_WAITING" });
}

async function unregisterForeignWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => {
        const activeUrl = registration.active?.scriptURL ?? "";
        return registration.scope.includes(window.location.origin) && !activeUrl.endsWith(SW_URL);
      })
      .map((registration) => registration.unregister()),
  );
}

function reloadOncePerController(): void {
  const controllerUrl = navigator.serviceWorker.controller?.scriptURL;
  if (!controllerUrl || sessionStorage.getItem(RELOAD_KEY) === controllerUrl) return;

  sessionStorage.setItem(RELOAD_KEY, controllerUrl);
  window.location.reload();
}

async function updateRegistration(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    await registration.update();
    requestSkipWaiting(registration.waiting);
  } catch {
    // O navegador tenta novamente na proxima abertura/foco do app.
  }
}

export function setupPwaAutoUpdate(): void {
  if (!("serviceWorker" in navigator)) return;

  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    reloadOncePerController();
  });

  window.addEventListener("load", () => {
    void (async () => {
      await unregisterForeignWorkers();

      const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      requestSkipWaiting(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            requestSkipWaiting(worker);
          }
        });
      });

      await updateRegistration(registration);

      window.addEventListener("focus", () => void updateRegistration(registration));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void updateRegistration(registration);
      });

      window.setInterval(() => void updateRegistration(registration), UPDATE_INTERVAL_MS);
    })().catch(() => {
      // Falha de registro nao deve travar a abertura do app.
    });
  });
}
