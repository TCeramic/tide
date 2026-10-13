import type { MediaCue, PlaybackBusEvent } from "../shared/contract";

/** Hidden audio element. The main process resolves the URL; this element plays it. */
export function mountPlayer(): () => void {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.setAttribute("aria-hidden", "true");
  document.body.append(audio);

  let loadedId: string | null = null;
  let activeUrl: string | null = null;
  let pendingSeek: number | null = null;

  const stopAudio = () => {
    loadedId = null;
    activeUrl = null;
    pendingSeek = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };

  const playAudio = () => {
    const url = activeUrl;
    if (!url) return;
    void audio.play().catch(() => {
      if (activeUrl !== url) return;
      void window.tide.failPlayback("no_url");
    });
  };

  const applySeek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    if (audio.readyState >= 1) {
      audio.currentTime = seconds;
      pendingSeek = null;
      return;
    }
    pendingSeek = seconds;
  };

  const onCue = (cue: MediaCue) => {
    if (!cue.url || !isHttpUrl(cue.url)) {
      stopAudio();
      return;
    }
    pendingSeek = null;
    loadedId = cue.trackId;
    activeUrl = cue.url;
    if (audio.src !== cue.url) audio.src = cue.url;
    playAudio();
  };

  const onEvent = (event: PlaybackBusEvent) => {
    if (event.type === "play") {
      playAudio();
      return;
    }
    if (event.type === "pause") {
      audio.pause();
      return;
    }
    if (event.type === "seek") {
      applySeek(event.positionMs / 1000);
      return;
    }
    if (event.type === "volume") {
      audio.volume = event.volume;
    }
  };

  audio.addEventListener("loadedmetadata", () => {
    if (pendingSeek == null) return;
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.paused || loadedId == null) return;
    window.tide.reportProgress(Math.round(audio.currentTime * 1000));
  });
  audio.addEventListener("ended", () => {
    if (loadedId == null || activeUrl == null) return;
    void window.tide.ended();
  });
  audio.addEventListener("error", () => {
    const failed = activeUrl;
    if (!failed) return;
    window.setTimeout(() => {
      if (activeUrl !== failed || !audio.error) return;
      activeUrl = null;
      loadedId = null;
      void window.tide.failPlayback("no_url");
    }, 0);
  });

  const stopMedia = window.tide.onMedia(onCue);
  const stopEvents = window.tide.onEvent(onEvent);
  void window.tide.getPlayback().then((snapshot) => {
    audio.volume = snapshot.volume;
  });

  return () => {
    stopMedia();
    stopEvents();
    stopAudio();
    audio.remove();
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
