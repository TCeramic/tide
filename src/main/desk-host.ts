import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import {
  DESK_LOCK_ACCELERATOR,
  clampDeskOrigin,
  deskSettingsFromUnknown,
  deskWindowSize,
  type DeskLyricsSettings,
} from "../core/desk-lyrics";
import { performanceBudget } from "../core/performance";
import { deskLineCue, immersiveProgress, lyricPosition, type LyricLine } from "../core/lyrics";
import type { PlaybackMachine } from "../core/playback/machine";
import { Ipc, type DeskCue, type YrcLine } from "../shared/contract";
import type { SettingsStore } from "./settings";

interface LyricBundle {
  trackId: string;
  title: string;
  original: LyricLine[];
  translation: LyricLine[];
  yrc: YrcLine[];
  offsetMs: number;
}

const EMPTY_BUNDLE: LyricBundle = {
  trackId: "",
  title: "",
  original: [],
  translation: [],
  yrc: [],
  offsetMs: 0,
};

/**
 * Desktop lyrics overlay. The window, timer, and lock shortcut exist only
 * while the feature is on, so a closed overlay does not keep a resident window.
 */
export function attachDeskLyrics(options: {
  settings: SettingsStore;
  machine: PlaybackMachine;
  getMainWindow: () => BrowserWindow | null;
  notify: (message: string) => void;
}): { close: () => void } {
  let overlay: BrowserWindow | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let shortcutArmed = false;
  let shortcutOpen = false;
  let bundle = { ...EMPTY_BUNDLE };
  let seenMs = 0;
  let seenAt = 0;
  let lastPayload = "";

  const read = () => options.settings.read().deskLyrics;

  const publishState = (settings: DeskLyricsSettings) => {
    const win = options.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(Ipc.deskState, settings);
  };

  const areas = () => screen.getAllDisplays().map((display) => display.workArea);

  const estimatePosition = () => {
    const state = options.machine.getState();
    const now = Date.now();
    if (state.status !== "playing" || state.positionMs !== seenMs) {
      seenMs = state.positionMs;
      seenAt = now;
      return state.positionMs;
    }
    return seenMs + (now - seenAt);
  };

  const cueNow = (): DeskCue => {
    const settings = read();
    const budget = performanceBudget(options.settings.read().performance);
    const state = options.machine.getState();
    const track = state.index >= 0 ? state.queue[state.index] : undefined;
    const same = Boolean(track && track.id === bundle.trackId);
    const at = lyricPosition(estimatePosition(), same ? bundle.offsetMs : 0);
    const swept = immersiveProgress(same ? bundle.yrc : [], same ? bundle.original : [], at);
    const frame = deskLineCue(
      same ? bundle.original : [],
      same ? bundle.translation : [],
      estimatePosition(),
      same ? bundle.offsetMs : 0,
      track?.title || bundle.title,
    );
    const text = swept.text || (frame.empty ? "" : frame.current);
    const translation = settings.pair && !frame.empty ? frame.translation : "";
    const follow = settings.highlightFollow && swept.wordLevel;
    return {
      title: frame.title,
      text,
      translation,
      progress: follow ? swept.progress : 1,
      wordLevel: follow,
      highlightFollow: settings.highlightFollow,
      playing: state.status === "playing",
      fontSize: settings.fontSize,
      color: settings.color,
      opacity: settings.opacity,
      glow: budget.deskFarGlow ? settings.glow : Math.min(settings.glow, 0.35),
      motion: settings.motion && budget.deskFps > 30,
      pair: settings.pair,
      wave: settings.wave && budget.deskFarGlow,
      farGlow: budget.deskFarGlow,
      empty: text.length === 0,
    };
  };

  const paint = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const cue = cueNow();
    const payload = JSON.stringify(cue);
    if (payload === lastPayload) return;
    lastPayload = payload;
    overlay.webContents.send(Ipc.deskCue, cue);
  };

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const armTimer = () => {
    stopTimer();
    const fps = performanceBudget(options.settings.read().performance).deskFps;
    timer = setInterval(paint, Math.max(16, Math.round(1000 / fps)));
  };

  const armShortcut = (open: boolean) => {
    if (open === shortcutOpen) return;
    shortcutOpen = open;
    if (shortcutArmed) {
      globalShortcut.unregister(DESK_LOCK_ACCELERATOR);
      shortcutArmed = false;
    }
    if (!open) return;
    try {
      shortcutArmed = globalShortcut.register(DESK_LOCK_ACCELERATOR, () => {
        const current = read();
        if (!current.open) return;
        apply({ locked: !current.locked });
      });
    } catch {
      shortcutArmed = false;
    }
    if (!shortcutArmed) {
      options.notify("Ctrl+Alt+L 没有注册成功。可以在设置里切换桌面歌词锁定。");
    }
  };

  const applyLock = (settings: DeskLyricsSettings) => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.setIgnoreMouseEvents(settings.locked);
  };

  const destroyOverlay = () => {
    stopTimer();
    lastPayload = "";
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = null;
    const win = overlay;
    overlay = null;
    if (win && !win.isDestroyed()) win.destroy();
  };

  const onMoved = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const [x, y] = overlay.getPosition();
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const next = deskSettingsFromUnknown({ ...read(), x, y });
      options.settings.write({ deskLyrics: next });
      publishState(next);
    }, 180);
  };

  const ensure = (settings: DeskLyricsSettings) => {
    if (overlay && !overlay.isDestroyed()) {
      const size = deskWindowSize(settings.fontSize, settings.pair);
      const bounds = overlay.getBounds();
      if (bounds.width !== size.width || bounds.height !== size.height) {
        overlay.setBounds({ x: bounds.x, y: bounds.y, ...size });
      }
      applyLock(settings);
      return;
    }
    const size = deskWindowSize(settings.fontSize, settings.pair);
    const origin = clampDeskOrigin(
      settings.x == null || settings.y == null ? null : { x: settings.x, y: settings.y },
      areas(),
      size,
    );
    const win = new BrowserWindow({
      ...size,
      ...origin,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    overlay = win;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on("moved", onMoved);
    win.once("ready-to-show", () => {
      if (overlay !== win || win.isDestroyed()) return;
      win.showInactive();
      applyLock(read());
      paint();
    });
    void win.loadFile(path.join(__dirname, "desk.html"));
    armTimer();
  };

  const apply = (patch: Partial<DeskLyricsSettings>): DeskLyricsSettings => {
    const next = deskSettingsFromUnknown({ ...read(), ...patch });
    options.settings.write({ deskLyrics: next });
    publishState(next);
    if (next.open) {
      ensure(next);
      armTimer();
    } else destroyOverlay();
    armShortcut(next.open);
    paint();
    return next;
  };

  const reclamp = () => {
    const settings = read();
    if (!settings.open || !overlay || overlay.isDestroyed()) return;
    const [x, y] = overlay.getPosition();
    const size = deskWindowSize(settings.fontSize, settings.pair);
    const origin = clampDeskOrigin({ x, y }, areas(), size);
    if (origin.x !== x || origin.y !== y) overlay.setPosition(origin.x, origin.y);
  };

  screen.on("display-removed", reclamp);
  screen.on("display-metrics-changed", reclamp);

  ipcMain.handle(Ipc.deskGet, () => read());
  ipcMain.handle(Ipc.deskSet, (_event, patch: unknown) => {
    const record = patch && typeof patch === "object" ? patch as Partial<DeskLyricsSettings> : {};
    return apply(record);
  });
  ipcMain.on(Ipc.deskLines, (_event, payload: unknown) => {
    bundle = readBundle(payload);
    lastPayload = "";
    paint();
  });

  if (read().open) apply(read());

  return {
    close() {
      screen.removeListener("display-removed", reclamp);
      screen.removeListener("display-metrics-changed", reclamp);
      ipcMain.removeHandler(Ipc.deskGet);
      ipcMain.removeHandler(Ipc.deskSet);
      ipcMain.removeAllListeners(Ipc.deskLines);
      if (shortcutArmed) globalShortcut.unregister(DESK_LOCK_ACCELERATOR);
      shortcutArmed = false;
      destroyOverlay();
    },
  };
}

function readBundle(value: unknown): LyricBundle {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    trackId: typeof record.trackId === "string" ? record.trackId : "",
    title: typeof record.title === "string" ? record.title.slice(0, 200) : "",
    original: linesOf(record.original),
    translation: linesOf(record.translation),
    yrc: yrcOf(record.yrc),
    offsetMs: typeof record.offsetMs === "number" && Number.isFinite(record.offsetMs) ? record.offsetMs : 0,
  };
}

function yrcOf(value: unknown): YrcLine[] {
  if (!Array.isArray(value)) return [];
  const lines: YrcLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { timeMs?: unknown; durationMs?: unknown; text?: unknown; words?: unknown };
    if (typeof row.timeMs !== "number" || !Number.isFinite(row.timeMs)) continue;
    if (typeof row.text !== "string" || row.text.trim().length === 0) continue;
    const words: YrcLine["words"] = [];
    if (Array.isArray(row.words)) {
      for (const word of row.words) {
        if (!word || typeof word !== "object") continue;
        const piece = word as { timeMs?: unknown; durationMs?: unknown; text?: unknown };
        if (typeof piece.timeMs !== "number" || typeof piece.durationMs !== "number" || typeof piece.text !== "string") continue;
        if (piece.text.length === 0) continue;
        words.push({
          timeMs: piece.timeMs,
          durationMs: Math.max(1, piece.durationMs),
          text: piece.text.slice(0, 80),
        });
      }
    }
    lines.push({
      timeMs: row.timeMs,
      durationMs: typeof row.durationMs === "number" && Number.isFinite(row.durationMs) ? row.durationMs : 0,
      text: row.text.slice(0, 400),
      words,
    });
    if (lines.length >= 4000) break;
  }
  return lines;
}

function linesOf(value: unknown): LyricLine[] {
  if (!Array.isArray(value)) return [];
  const lines: LyricLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { timeMs?: unknown; text?: unknown };
    if (typeof row.timeMs !== "number" || !Number.isFinite(row.timeMs)) continue;
    if (typeof row.text !== "string" || row.text.trim().length === 0) continue;
    lines.push({ timeMs: row.timeMs, text: row.text.slice(0, 400) });
    if (lines.length >= 4000) break;
  }
  return lines;
}
