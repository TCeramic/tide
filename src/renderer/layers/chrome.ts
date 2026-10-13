import type { HealthStatus, PlaybackSnapshot } from "../../shared/contract";

const DISCLAIMER_KEY = "tide.risk.ack";

const STATUS_LABEL: Record<PlaybackSnapshot["status"], string> = {
  idle: "空闲",
  loading: "载入",
  playing: "播放中",
  paused: "已暂停",
  error: "出错",
};

const ERROR_LABEL: Record<NonNullable<PlaybackSnapshot["error"]>, string> = {
  empty_queue: "队列为空",
  track_missing: "曲目不存在",
};

export function mountChrome(root: HTMLElement): {
  setPlayback: (snapshot: PlaybackSnapshot) => void;
  setHealth: (status: HealthStatus) => void;
  destroy: () => void;
} {
  root.replaceChildren();

  let latest: PlaybackSnapshot | null = null;
  let currentIndex = -1;

  const disclaimer = document.createElement("section");
  disclaimer.className = "disclaimer";
  disclaimer.hidden = readAck();

  const disclaimerTitle = document.createElement("h1");
  disclaimerTitle.textContent = "使用前请阅读";

  const disclaimerBody = document.createElement("p");
  disclaimerBody.textContent =
    "潮汐是非官方客户端，仅供个人自用。使用非官方接口和 Cookie（含 MUSIC_U）可能违反网易云服务条款，并可能导致接口失效或账号受限。继续使用即表示这些后果由你自行承担。 Unofficial client for personal use. Account limits are your risk.";

  const ack = document.createElement("button");
  ack.type = "button";
  ack.className = "text-button";
  ack.textContent = "知道了";
  ack.addEventListener("click", () => {
    writeAck();
    disclaimer.hidden = true;
  });

  disclaimer.append(disclaimerTitle, disclaimerBody, ack);

  const transport = document.createElement("footer");
  transport.className = "transport";

  const wordmark = document.createElement("span");
  wordmark.className = "wordmark";
  wordmark.textContent = "潮汐";

  const prev = button("上一首", () => {
    const index = currentIndex - 1;
    if (index >= 0) void window.tide.changeTrack(index);
  });
  const play = button("播放", () => {
    if (latest?.status === "playing") void window.tide.pause();
    else void window.tide.play();
  });
  play.classList.add("play");
  const next = button("下一首", () => {
    if (!latest) return;
    const index = currentIndex + 1;
    if (index < latest.queue.length) void window.tide.changeTrack(index);
  });

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("span");
  title.className = "track-title";
  const detail = document.createElement("span");
  detail.className = "track-detail";
  meta.append(title, detail);

  const seek = document.createElement("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = "0";
  seek.value = "0";
  seek.step = "100";
  seek.setAttribute("aria-label", "进度");
  let seeking = false;
  seek.addEventListener("pointerdown", () => {
    seeking = true;
  });
  seek.addEventListener("pointerup", () => {
    seeking = false;
  });
  seek.addEventListener("change", () => {
    seeking = false;
    void window.tide.seek(Number(seek.value));
  });

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "80";
  volume.step = "1";
  volume.setAttribute("aria-label", "音量");
  let adjustingVolume = false;
  volume.addEventListener("pointerdown", () => {
    adjustingVolume = true;
  });
  volume.addEventListener("pointerup", () => {
    adjustingVolume = false;
  });
  volume.addEventListener("input", () => {
    void window.tide.setVolume(Number(volume.value) / 100);
  });

  const health = document.createElement("span");
  health.className = "health";
  health.textContent = "本地 API · 检查中";

  transport.append(wordmark, prev, play, next, meta, seek, volume, health);
  root.append(disclaimer, transport);

  const setPlayback = (snapshot: PlaybackSnapshot) => {
    latest = snapshot;
    currentIndex = snapshot.index;
    const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
    title.textContent = track?.title ?? "没有曲目";
    const status = STATUS_LABEL[snapshot.status];
    const error = snapshot.error ? ERROR_LABEL[snapshot.error] : "";
    const position = formatTime(snapshot.positionMs);
    const duration = formatTime(track?.durationMs ?? 0);
    detail.textContent = error
      ? `${status} · ${error}`
      : `${track?.artist ?? "潮汐"} · ${status} · ${position} / ${duration}`;

    play.textContent = snapshot.status === "playing" ? "暂停" : snapshot.status === "loading" ? "…" : "播放";
    prev.disabled = snapshot.index <= 0;
    next.disabled = snapshot.index < 0 || snapshot.index >= snapshot.queue.length - 1;

    const durationMs = track?.durationMs ?? 0;
    seek.max = String(durationMs);
    seek.disabled = !track;
    if (!seeking) seek.value = String(Math.min(snapshot.positionMs, durationMs));
    if (!adjustingVolume) volume.value = String(Math.round(snapshot.volume * 100));
  };

  const setHealth = (status: HealthStatus) => {
    health.dataset.ok = status.ok ? "true" : "false";
    health.textContent = status.ok ? `本地 API · ${status.port ?? ""}` : "本地 API · 未就绪";
  };

  return {
    setPlayback,
    setHealth,
    destroy: () => root.replaceChildren(),
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "text-button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function readAck(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAck(): void {
  try {
    localStorage.setItem(DISCLAIMER_KEY, "1");
  } catch {
    // The card still closes for this session when storage is unavailable.
  }
}
