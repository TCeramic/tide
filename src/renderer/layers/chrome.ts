import type { HealthStatus, PlaybackSnapshot } from "../../shared/contract";
import {
  Compass,
  Grid3x3,
  Heart,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide";
import { ICON_SIZE, iconButton, setIcon } from "../icons";
import { onLattice, readLattice, writeLattice } from "../lattice-pref";
import { applyLike, isLiked, onLiked } from "../liked";

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
  no_url: "没有可播放的地址",
  signed_out: "请先登录",
};

const REPEAT_CYCLE = ["off", "all", "one"] as const;

const REPEAT_LABEL: Record<(typeof REPEAT_CYCLE)[number], string> = {
  off: "顺序播放",
  all: "列表循环",
  one: "单曲循环",
};

export function mountChrome(root: HTMLElement): {
  setPlayback: (snapshot: PlaybackSnapshot) => void;
  setHealth: (status: HealthStatus) => void;
  destroy: () => void;
} {
  root.replaceChildren();

  let latest: PlaybackSnapshot | null = null;

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
  const mark = document.createElement("span");
  mark.className = "wordmark-icon";
  setIcon(mark, "Music2", Music2, ICON_SIZE.control);
  const markText = document.createElement("span");
  markText.textContent = "潮汐";
  wordmark.append(mark, markText);

  const prev = iconButton("上一首", "SkipBack", SkipBack, ICON_SIZE.control);
  prev.addEventListener("click", () => {
    void window.tide.previous();
  });
  const play = iconButton("播放", "Play", Play, ICON_SIZE.play);
  play.classList.add("play");
  play.addEventListener("click", () => {
    if (latest?.status === "playing") void window.tide.pause();
    else void window.tide.play();
  });
  const next = iconButton("下一首", "SkipForward", SkipForward, ICON_SIZE.control);
  next.addEventListener("click", () => {
    void window.tide.next();
  });
  const mode = iconButton("列表循环", "Repeat", Repeat, ICON_SIZE.control);
  mode.addEventListener("click", () => {
    const current = latest?.repeat ?? "all";
    const index = REPEAT_CYCLE.indexOf(current);
    const repeat = REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? "all";
    void window.tide.setMode({ repeat });
  });
  const shuffle = iconButton("随机播放", "Shuffle", Shuffle, ICON_SIZE.control);
  shuffle.addEventListener("click", () => {
    void window.tide.setMode({ shuffle: !(latest?.shuffle ?? false) });
  });
  const explore = iconButton("探索续播", "Compass", Compass, ICON_SIZE.control);
  explore.addEventListener("click", () => {
    void window.tide.setMode({ explore: !(latest?.explore ?? false) });
  });
  const lattice = iconButton("点阵", "Grid3x3", Grid3x3, ICON_SIZE.control);
  lattice.classList.add("lattice-toggle");
  lattice.setAttribute("aria-pressed", readLattice() ? "true" : "false");
  lattice.addEventListener("click", () => {
    writeLattice(!readLattice());
  });

  const controls = document.createElement("div");
  controls.className = "transport-controls";
  controls.append(prev, play, next, mode, shuffle, explore, lattice);

  const meta = document.createElement("div");
  meta.className = "meta";
  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  const like = iconButton("喜欢", "Heart", Heart, ICON_SIZE.control);
  like.addEventListener("click", () => {
    const track = latest && latest.index >= 0 ? latest.queue[latest.index] : undefined;
    if (!track) return;
    const wanted = !isLiked(track.id);
    void window.tide.likeSong(track.id, wanted).then((result) => {
      if (!result.ok) return;
      applyLike(track.id, result.liked);
    });
  });
  like.classList.add("like");
  const title = document.createElement("span");
  title.className = "track-title";
  titleRow.append(like, title);
  const detail = document.createElement("span");
  detail.className = "track-detail";
  meta.append(titleRow, detail);

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

  const volumeIcon = document.createElement("span");
  volumeIcon.className = "volume-icon";
  volumeIcon.setAttribute("aria-hidden", "true");
  setIcon(volumeIcon, "Volume2", Volume2, ICON_SIZE.control);
  const volumeWrap = document.createElement("div");
  volumeWrap.className = "volume";
  volumeWrap.append(volumeIcon, volume);

  transport.append(wordmark, controls, meta, seek, volumeWrap);
  root.append(disclaimer, transport);

  const setPlayback = (snapshot: PlaybackSnapshot) => {
    latest = snapshot;
    const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
    title.textContent = track?.title ?? "没有曲目";
    const status = STATUS_LABEL[snapshot.status];
    const error = snapshot.error ? ERROR_LABEL[snapshot.error] : "";
    const position = formatTime(snapshot.positionMs);
    const duration = formatTime(track?.durationMs ?? 0);
    detail.textContent = error
      ? `${status} · ${error}`
      : `${track?.artist ?? "潮汐"} · ${status} · ${position} / ${duration}`;

    like.hidden = !track;
    const liked = track ? isLiked(track.id) : false;
    like.classList.toggle("on", liked);
    like.setAttribute("aria-label", liked ? "取消喜欢" : "喜欢");
    setIcon(like, "Heart", Heart, ICON_SIZE.control, liked);

    const playing = snapshot.status === "playing";
    play.classList.toggle("is-playing", playing);
    play.setAttribute("aria-label", playing ? "暂停" : "播放");
    setIcon(play, playing ? "Pause" : "Play", playing ? Pause : Play, ICON_SIZE.play);
    const hasQueue = snapshot.queue.length > 0 && snapshot.index >= 0;
    const atStart = snapshot.index <= 0;
    const atEnd = snapshot.index < 0 || snapshot.index >= snapshot.queue.length - 1;
    prev.disabled = !hasQueue || (atStart && snapshot.repeat !== "all");
    next.disabled = !hasQueue || (atEnd && snapshot.repeat !== "all" && !(snapshot.shuffle && snapshot.queue.length > 1));

    mode.setAttribute("aria-label", REPEAT_LABEL[snapshot.repeat]);
    mode.setAttribute("aria-pressed", snapshot.repeat === "off" ? "false" : "true");
    setIcon(mode, snapshot.repeat === "one" ? "Repeat1" : "Repeat", snapshot.repeat === "one" ? Repeat1 : Repeat, ICON_SIZE.control);
    shuffle.setAttribute("aria-pressed", snapshot.shuffle ? "true" : "false");
    explore.setAttribute("aria-pressed", snapshot.explore ? "true" : "false");
    const volumeIconName = snapshot.volume <= 0 ? "VolumeX" : snapshot.volume < 0.5 ? "Volume1" : "Volume2";
    const volumeNode = snapshot.volume <= 0 ? VolumeX : snapshot.volume < 0.5 ? Volume1 : Volume2;
    setIcon(volumeIcon, volumeIconName, volumeNode, ICON_SIZE.control);

    const durationMs = track?.durationMs ?? 0;
    seek.max = String(durationMs);
    seek.disabled = !track;
    if (!seeking) seek.value = String(Math.min(snapshot.positionMs, durationMs));
    if (!adjustingVolume) volume.value = String(Math.round(snapshot.volume * 100));
  };

  const setHealth = (status: HealthStatus) => {
    root.dataset.api = status.ok ? "ready" : "down";
  };

  const stopLiked = onLiked(() => {
    if (latest) setPlayback(latest);
  });
  const stopLattice = onLattice((on) => {
    lattice.setAttribute("aria-pressed", on ? "true" : "false");
  });

  return {
    setPlayback,
    setHealth,
    destroy: () => {
      stopLiked();
      stopLattice();
      root.replaceChildren();
    },
  };
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

