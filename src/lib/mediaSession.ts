interface MediaSessionControls {
  play: () => void;
  pause: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
}

interface MediaSessionState {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaImage[];
  duration?: number;
  position?: number;
  playbackRate?: number;
  playing: boolean;
  controls: MediaSessionControls;
}

export function mediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function updateMediaSession(state: MediaSessionState): void {
  if (!mediaSessionSupported()) return;

  const session = navigator.mediaSession;
  session.metadata = new MediaMetadata({
    title: state.title,
    artist: state.artist || "Nhagriot",
    album: state.album,
    artwork: state.artwork,
  });
  session.playbackState = state.playing ? "playing" : "paused";

  setActionHandler("play", () => state.controls.play());
  setActionHandler("pause", () => state.controls.pause());
  setActionHandler("previoustrack", () => state.controls.seekBy(-10));
  setActionHandler("nexttrack", () => state.controls.seekBy(10));
  setActionHandler("seekbackward", (details) => {
    state.controls.seekBy(-(details.seekOffset || 10));
  });
  setActionHandler("seekforward", (details) => {
    state.controls.seekBy(details.seekOffset || 10);
  });
  setActionHandler("seekto", (details) => {
    if (typeof details.seekTime === "number") state.controls.seekTo(details.seekTime);
  });

  if (
    typeof session.setPositionState === "function" &&
    Number.isFinite(state.duration) &&
    Number.isFinite(state.position) &&
    state.duration! > 0
  ) {
    try {
      session.setPositionState({
        duration: Math.max(1, state.duration!),
        position: Math.max(0, Math.min(state.duration!, state.position!)),
        playbackRate: state.playbackRate || 1,
      });
    } catch {
      // Safari can reject transient values while audio is still buffering.
    }
  }
}

export function clearMediaSession(): void {
  if (!mediaSessionSupported()) return;
  const session = navigator.mediaSession;
  session.playbackState = "none";
  session.metadata = null;
  for (const action of [
    "play",
    "pause",
    "previoustrack",
    "nexttrack",
    "seekbackward",
    "seekforward",
    "seekto",
  ] as MediaSessionAction[]) {
    setActionHandler(action, null);
  }
}

function setActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some platforms expose only a subset of Media Session actions.
  }
}
