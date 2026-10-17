import type { HealthStatus, PlaybackSnapshot } from "../../shared/contract";
import {
  Compass,
  Heart,
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
import { applyLike, isLiked, onLiked } from "../liked";
import { paintCover } from "../cover";
import { toggleNowPlaying, onShellView } from "../view";
import { mountMarquee } from "../marquee";

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

const PLAY_MODES = [
  { repeat: "all", shuffle: false, explore: false, label: "列表循环" },
  { repeat: "one", shuffle: false, explore: false, label: "单曲循环" },
  { repeat: "off", shuffle: false, explore: true, label: "顺序" },
  { repeat: "off", shuffle: true, explore: true, label: "随机" },
] as const;

export function mountChrome(root: HTMLElement): {
  setPlayback: (snapshot: PlaybackSnapshot) => void;
  setHealth: (status: HealthStatus) => void;
  setLattice: (on: boolean) => void;
  destroy: () => void;
} {
  root.replaceChildren();

  let latest: PlaybackSnapshot | null = null;

  const titlebar = document.createElement("header");
  titlebar.className = "tide-titlebar";
  titlebar.textContent = "潮汐";
  document.body.append(titlebar);

  const transport = document.createElement("footer");
  transport.className = "transport";

  const prev = iconButton("上一首", "SkipBack", SkipBack, ICON_SIZE.control);
  prev.addEventListener("click", () => {
    void window.tide.previous();
  });
  const play = iconButton("播放", "Play", Play, ICON_SIZE.play);
  play.classList.add("play");
  play.addEventListener("click", () => {
    if (latest?.status === "playing") void window.tide.pause();
    else {
      void window.tide.play();
    }
  });
  const next = iconButton("下一首", "SkipForward", SkipForward, ICON_SIZE.control);
  next.addEventListener("click", () => {
    void window.tide.next();
  });
  const mode = iconButton("列表循环", "Repeat", Repeat, ICON_SIZE.control);
  mode.addEventListener("click", () => {
    const index = modeIndex(latest);
    const next = PLAY_MODES[(index + 1) % PLAY_MODES.length] ?? PLAY_MODES[0];
    void window.tide.setMode({ repeat: next.repeat, shuffle: next.shuffle, explore: next.explore });
  });
  const controls = document.createElement("div");
  controls.className = "transport-controls";
  controls.append(prev, play, next, mode);

  const cover = document.createElement("button");
  cover.type = "button";
  cover.className = "dock-cover";
  const syncCoverAction = () => {
    const label = document.documentElement.dataset.view === "playing" ? "返回上一页" : "打开歌词页";
    cover.setAttribute("aria-label", label); cover.title = label;
  };
  cover.addEventListener("click", toggleNowPlaying);
  const stopView = onShellView(syncCoverAction); syncCoverAction();
  paintCover(cover, undefined);
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
  const marquee = mountMarquee(title);
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
  const seekPreview = document.createElement("output");
  seekPreview.className = "seek-preview";
  seekPreview.hidden = true;
  const previewSeek = () => {
    const duration = Number(seek.max);
    seekPreview.textContent = `${formatTime(Number(seek.value))} / ${formatTime(duration)}`;
    seek.setAttribute("aria-valuetext", seekPreview.textContent);
    seekPreview.style.setProperty("--seek-at", `${duration > 0 ? Number(seek.value) / duration * 100 : 0}%`);
  };
  let seeking = false;
  seek.addEventListener("pointerdown", () => {
    seeking = true;
    seekPreview.hidden = false;
    previewSeek();
  });
  seek.addEventListener("pointerup", () => {
    seeking = false;
    seekPreview.hidden = true;
  });
  seek.addEventListener("input", () => { seeking = true; seekPreview.hidden = false; previewSeek(); });
  seek.addEventListener("pointercancel", () => { seeking = false; seekPreview.hidden = true; });
  seek.addEventListener("blur", () => { seeking = false; seekPreview.hidden = true; });
  seek.addEventListener("keyup", () => { seeking = false; seekPreview.hidden = true; });
  seek.addEventListener("change", () => {
    seeking = false;
    seekPreview.hidden = true;
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

  const seekRow = document.createElement("div");
  seekRow.className = "dock-seek";
  seekRow.append(seek);
  seekRow.append(seekPreview);
  const dockMain = document.createElement("div");
  dockMain.className = "dock-main";
  dockMain.append(cover, meta, controls, volumeWrap);
  transport.append(dockMain, seekRow);
  const dock=document.createElement("div");dock.className="dock-shell";dock.append(transport);
  const zone=document.createElement("div");zone.className="dock-trigger";zone.setAttribute("aria-label","显示播放栏");root.append(dock,zone);
  const abort=new AbortController();let hideTimer=0;
  const showDock=()=>{clearTimeout(hideTimer);document.documentElement.dataset.dockVisible="true";};
  const hideDock=()=>{clearTimeout(hideTimer);hideTimer=window.setTimeout(()=>{if(!dock.matches(":hover")&&!zone.matches(":hover")&&!dock.querySelector(":focus-visible"))document.documentElement.dataset.dockVisible="false";},260);};
  for(const el of [zone,dock]){el.addEventListener("pointerenter",showDock,{signal:abort.signal});el.addEventListener("pointerleave",hideDock,{signal:abort.signal});}dock.addEventListener("focusin",showDock,{signal:abort.signal});dock.addEventListener("focusout",hideDock,{signal:abort.signal});
  window.addEventListener("blur",()=>document.documentElement.dataset.dockVisible="false",{signal:abort.signal});
  document.addEventListener("pointerdown",e=>{if(e.target instanceof Node&&!dock.contains(e.target)&&!zone.contains(e.target))document.documentElement.dataset.dockVisible="false";},{signal:abort.signal});
  document.documentElement.dataset.dockVisible="false";const dockResize=new ResizeObserver(()=>dock.style.setProperty("--dock-shell-h",`${transport.getBoundingClientRect().height}px`));dockResize.observe(transport);


  const setPlayback = (snapshot: PlaybackSnapshot) => {
    latest = snapshot;
    const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
    marquee.set(track?.title ?? "没有曲目");
    if (cover.dataset.cover !== (track?.cover ?? "")) {
      cover.dataset.cover = track?.cover ?? "";
      paintCover(cover, track?.cover);
    }
    const status = STATUS_LABEL[snapshot.status];
    const error = snapshot.error ? ERROR_LABEL[snapshot.error] : "";
    const position = formatTime(snapshot.positionMs);
    const duration = formatTime(track?.durationMs ?? 0);
    const detailText = error ? `${status} · ${error}` : `${track?.artist ?? "潮汐"} · ${status} · ${position} / ${duration}`;
    if (detail.textContent !== detailText) detail.textContent = detailText;

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
    next.disabled = !hasQueue || (atEnd && snapshot.repeat !== "all" && !(snapshot.shuffle && snapshot.queue.length > 1) && !snapshot.explore);

    const modeNow = PLAY_MODES[modeIndex(snapshot)] ?? PLAY_MODES[0];
    mode.setAttribute("aria-label", modeNow.label);
    mode.setAttribute("aria-pressed", "true");
    const modeIcon = modeNow.label === "单曲循环" ? Repeat1 : modeNow.label === "随机" ? Shuffle : modeNow.label === "顺序" ? Compass : Repeat;
    const modeName = modeNow.label === "单曲循环" ? "Repeat1" : modeNow.label === "随机" ? "Shuffle" : modeNow.label === "顺序" ? "Compass" : "Repeat";
    setIcon(mode, modeName, modeIcon, ICON_SIZE.control);
    const volumeIconName = snapshot.volume <= 0 ? "VolumeX" : snapshot.volume < 0.5 ? "Volume1" : "Volume2";
    const volumeNode = snapshot.volume <= 0 ? VolumeX : snapshot.volume < 0.5 ? Volume1 : Volume2;
    setIcon(volumeIcon, volumeIconName, volumeNode, ICON_SIZE.control);

    const durationMs = track?.durationMs ?? 0;
    cover.disabled = !track;
    seek.max = String(durationMs);
    seek.disabled = !track;
    if (!seeking) seek.value = String(Math.min(snapshot.positionMs, durationMs));
    seek.dataset.playing = String(snapshot.status === "playing");
    seek.dispatchEvent(new Event("tide:progress"));
    if (!adjustingVolume) volume.value = String(Math.round(snapshot.volume * 100));
  };

  const setHealth = (status: HealthStatus) => {
    root.dataset.api = status.ok ? "ready" : "down";
  };

  const stopLiked = onLiked(() => {
    if (latest) setPlayback(latest);
  });

  return {
    setPlayback,
    setHealth,
    setLattice(on: boolean) {
      void on;
      // The lattice switch lives in Settings. The stage still follows appearance.
    },
    destroy: () => {
      abort.abort();clearTimeout(hideTimer);dockResize.disconnect();
      stopLiked();
      stopView();
      marquee.destroy();
      root.replaceChildren();
    },
  };
}

function modeIndex(snapshot: PlaybackSnapshot | null): number {
  if (!snapshot) return 0;
  const found = PLAY_MODES.findIndex((mode) =>
    mode.repeat === snapshot.repeat && mode.shuffle === snapshot.shuffle && mode.explore === snapshot.explore);
  return found >= 0 ? found : 0;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
