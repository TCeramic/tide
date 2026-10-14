import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { LocalLibrary } from "../api/local-library";
import { isAudioLevel } from "../core/audio-level";
import {
  applyShortcutPlan,
  appCommandName,
  createMediaDeduper,
  isMediaAction,
  mediaShortcutsFromUnknown,
  planCustomShortcuts,
  shortcutAction,
  syncSystemMediaKeys,
  type MediaAction,
  type MediaSource,
} from "../core/media-keys";
import { appearancePatchFromArgs } from "../core/command-bus";
import { PlaybackMachine } from "../core/playback/machine";
import { DEFAULT_API_PORT, DEFAULT_BUS_PORT, Ipc, type Appearance, type HealthStatus } from "../shared/contract";
import { checkHealth, serverBundlePath, startApiProcess, type ApiProcess } from "./api-host";
import { BusAllowStore, BusTokenStore } from "./bus-files";
import { startCommandServer, type RunningCommandServer } from "./command-server";
import { ListenLog } from "./listen-log";
import { attachPlayback } from "./playback-host";
import { attachSession, loopbackJson } from "./session-host";
import { attachDeskLyrics } from "./desk-host";
import { SettingsStore } from "./settings";
import { loadTideToday } from "./tide-today";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.TIDE_USER_DATA) app.setPath("userData", process.env.TIDE_USER_DATA);

let mainWindow: BrowserWindow | null = null;
let activeBusPort = DEFAULT_BUS_PORT;
let apiProcess: ApiProcess | null = null;
let apiPort: number | null = null;
let detachPlayback: (() => void) | null = null;
let detachSession: (() => void) | null = null;
let commandServer: RunningCommandServer | null = null;
let settingsStore: SettingsStore | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let quitting = false;
let runHardware: (source: MediaSource, action: unknown) => void = () => undefined;
let mediaNotice: string | null = null;
let closeDesk: () => void = () => undefined;

function windowIcon(): string {
  return path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png");
}

const machine = new PlaybackMachine();

function bindHardwareWindow(win: BrowserWindow): void {
  win.on("app-command", (event, command) => {
    const action = appCommandName(command);
    if (!action) return;
    event.preventDefault();
    runHardware("app-command", action);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: "#071018",
    title: "潮汐 Tide",
    icon: windowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("close", () => {
    closeDesk();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-finish-load", () => {
    win.webContents.send(Ipc.playback, machine.getState());
    const current = settingsStore?.read();
    if (current) win.webContents.send(Ipc.appearance, appearanceOf(current));
    if (mediaNotice) win.webContents.send(Ipc.notice, mediaNotice);
    void publishHealth();
  });
  bindHardwareWindow(win);

  void win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

async function publishHealth(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const status: HealthStatus = apiPort == null
    ? { ok: false, error: "stopped", busPort: activeBusPort }
    : { ...(await checkHealth(apiPort)), busPort: activeBusPort };
  if (win.isDestroyed()) return;
  win.webContents.send(Ipc.health, status);
}

function stopApi(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  const running = apiProcess;
  apiProcess = null;
  apiPort = null;
  running?.stop();
}

function appearanceOf(value: Appearance): Appearance {
  return {
    chromeVisible: value.chromeVisible,
    stageLevel: value.stageLevel,
    theme: value.theme,
    motion: value.motion,
    lattice: value.lattice,
    shell: value.shell,
    preset: value.preset,
    performance: value.performance,
    background: value.background,
  };
}

function pushAppearance(): void {
  if (!settingsStore) return;
  const appearance = appearanceOf(settingsStore.read());
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send(Ipc.appearance, appearance);
  commandServer?.publish({ type: "appearance", appearance });
}

function shutdown(): void {
  if (quitting) return;
  quitting = true;
  stopApi();
  const bus = commandServer;
  commandServer = null;
  void bus?.close();
  detachPlayback?.();
  detachPlayback = null;
  detachSession?.();
  detachSession = null;
  app.quit();
}

app.whenReady().then(async () => {
  ipcMain.handle(Ipc.healthGet, () =>
    apiPort == null
      ? Promise.resolve({ ok: false, error: "stopped", busPort: activeBusPort } satisfies HealthStatus)
      : checkHealth(apiPort).then((status) => ({ ...status, busPort: activeBusPort })),
  );

  const settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  settingsStore = settings;
  const desk = attachDeskLyrics({
    settings,
    machine,
    getMainWindow: () => mainWindow,
    notify: (message) => {
      const win = mainWindow;
      if (win && !win.isDestroyed()) win.webContents.send(Ipc.notice, message);
    },
  });
  closeDesk = desk.close;
  const listenLog = new ListenLog(path.join(app.getPath("userData"), "listen-log.json"));
  machine.setVolume(settings.read().volume);
  const playback = attachPlayback(() => mainWindow, machine, () => apiPort, (volume) => {
    settings.write({ volume });
  }, listenLog, () => settings.read().quality);
  const libraryFile = path.join(app.getPath("userData"), "local-library.json");
  const backdropFile = path.join(app.getPath("userData"), "backdrop");
  ipcMain.handle(Ipc.localList, () => new LocalLibrary(libraryFile).list());
  ipcMain.handle(Ipc.localAdd, async () => {
    const picked = await dialog.showOpenDialog({
      title: "添加本地音乐",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "音频", extensions: ["mp3", "flac", "m4a", "wav", "ogg", "aac"] }],
    });
    const library = new LocalLibrary(libraryFile);
    if (picked.canceled) return library.list();
    return library.add(picked.filePaths);
  });
  const readBackdrop = (): string | null => {
    try {
      const bytes = fs.readFileSync(backdropFile);
      if (bytes.length === 0 || bytes.length > 1_800_000) return null;
      const mime = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x52 ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };
  ipcMain.handle(Ipc.backdropUrl, () => readBackdrop());
  ipcMain.handle(Ipc.backdropPick, async () => {
    const picked = await dialog.showOpenDialog({
      title: "选择背景图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    fs.copyFileSync(file, backdropFile);
    return readBackdrop();
  });
  ipcMain.handle(Ipc.appearanceSet, (_event, patch: unknown) => {
    const parsed = appearancePatchFromArgs(patch);
    if (!parsed || !settingsStore) return appearanceOf(settings.read());
    const next = settings.write(parsed);
    pushAppearance();
    return appearanceOf(next);
  });
  ipcMain.handle(Ipc.qualityGet, () => settings.read().quality);
  ipcMain.handle(Ipc.qualitySet, (_event, level: unknown) => {
    if (!isAudioLevel(level)) return settings.read().quality;
    return settings.write({ quality: level }).quality;
  });
  const mediaDeduper = createMediaDeduper();
  const registeredCustom = new Set<string>();
  let shortcutMessages: string[] = [];

  const performHardware = (action: MediaAction) => {
    if (action === "toggle") {
      if (machine.getState().status === "playing") playback.control.pause();
      else void playback.control.play();
      return;
    }
    if (action === "play") {
      void playback.control.play();
      return;
    }
    if (action === "pause") {
      playback.control.pause();
      return;
    }
    if (action === "next") {
      void playback.control.next();
      return;
    }
    if (action === "previous") {
      void playback.control.previous();
      return;
    }
    playback.control.stop();
  };

  runHardware = (source, action) => {
    if (!isMediaAction(action)) return;
    if (!mediaDeduper.accept(action, source, Date.now())) return;
    performHardware(action);
  };

  const registeredSystem: string[] = [];
  const syncCapture = (capture: boolean) => {
    const result = syncSystemMediaKeys(
      capture,
      registeredSystem,
      (accelerator) => {
        const action = shortcutAction(accelerator);
        if (!action) return false;
        return globalShortcut.register(accelerator, () => {
          runHardware("shortcut", action);
        });
      },
      (accelerator) => {
        globalShortcut.unregister(accelerator);
      },
    );
    registeredSystem.splice(0, registeredSystem.length, ...result.active);
    return result.missed;
  };
  const missed = syncCapture(settings.read().captureMediaKeys);
  const builtinMediaWarning = missed.length > 0
    ? "系统媒体键没有注册成功，可能已被占用。可在「热键」里改用 Ctrl+Alt+方向键。"
    : null;

  const applyCustomShortcuts = (desired: ReturnType<typeof mediaShortcutsFromUnknown>) => {
    const previous = settings.read().mediaShortcuts;
    for (const accelerator of registeredCustom) globalShortcut.unregister(accelerator);
    registeredCustom.clear();
    const plan = planCustomShortcuts(desired);
    const outcome = applyShortcutPlan(plan, previous, (accelerator, action) => {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => {
          runHardware("shortcut", action);
        });
      } catch {
        ok = false;
      }
      if (ok) registeredCustom.add(accelerator);
      return ok;
    });
    shortcutMessages = outcome.messages;
    return outcome;
  };
  applyCustomShortcuts(settings.read().mediaShortcuts);
  const startupKeyNotice = [builtinMediaWarning, shortcutMessages.join(" ")].filter((item): item is string => typeof item === "string" && item.length > 0).join(" ");
  mediaNotice = startupKeyNotice.length > 0 ? startupKeyNotice : null;
  ipcMain.handle(Ipc.mediaShortcutsGet, () => ({
    shortcuts: settings.read().mediaShortcuts,
    messages: shortcutMessages,
    captureMediaKeys: settings.read().captureMediaKeys,
  }));
  ipcMain.handle(Ipc.captureMediaKeysSet, (_event, value: unknown) => {
    const capture = value !== false;
    settings.write({ captureMediaKeys: capture });
    const failed = syncCapture(capture);
    const win = mainWindow;
    if (failed.length > 0 && win && !win.isDestroyed()) {
      win.webContents.send(Ipc.notice, "系统媒体键没有注册成功，可能已被占用。可在「热键」里改用 Ctrl+Alt+方向键。");
    }
    return { captureMediaKeys: settings.read().captureMediaKeys };
  });
  ipcMain.handle(Ipc.mediaShortcutsSet, (_event, value: unknown) => {
    const outcome = applyCustomShortcuts(mediaShortcutsFromUnknown(value));
    settings.write({ mediaShortcuts: outcome.saved });
    const win = mainWindow;
    if (outcome.messages.length > 0 && win && !win.isDestroyed()) {
      win.webContents.send(Ipc.notice, outcome.messages.join(" "));
    }
    return { shortcuts: outcome.saved, messages: outcome.messages };
  });
  ipcMain.handle(Ipc.hardwareKey, (_event, action: unknown) => {
    runHardware("session", action);
    return playback.control.get();
  });
  detachPlayback = playback.detach;
  detachSession = attachSession(() => apiPort);
  for (const type of ["play", "pause", "seek", "volume", "queue", "track-change"] as const) {
    machine.events.on(type, (payload) => {
      commandServer?.publish({ type: "playback", event: type, snapshot: payload.snapshot });
    });
  }
  const busPort = Number(process.env.TIDE_BUS_PORT ?? DEFAULT_BUS_PORT);
  activeBusPort = Number.isInteger(busPort) && busPort >= 0 && busPort <= 65535 ? busPort : DEFAULT_BUS_PORT;
  try {
    commandServer = await startCommandServer({
      token: new BusTokenStore(path.join(app.getPath("userData"), "bus-token")).read(),
      port: activeBusPort,
      readAllow: () => new BusAllowStore(path.join(app.getPath("userData"), "bus-allow.json")).read(),
      getSession: () => loopbackJson(apiPort, "GET", "/session"),
      onClient: (send) => {
        send({ type: "playback", snapshot: machine.getState() });
        send({ type: "appearance", appearance: appearanceOf(settings.read()) });
      },
      host: {
        playbackGet: () => playback.control.get(),
        playbackPlay: () => playback.control.play(),
        playbackPause: () => playback.control.pause(),
        playbackSeek: (positionMs) => playback.control.seek(positionMs),
        playbackVolume: (volume) => playback.control.setVolume(volume, false),
        playbackNext: () => playback.control.next(),
        playbackPrev: () => playback.control.previous(),
        playbackQueue: (queue, index) => playback.control.queue({ queue, index }),
        playbackPlayHits: async (hits, index) => (await playback.control.playHits(hits, index)) ?? playback.control.get(),
        playbackMode: (patch) => playback.control.setMode(patch),
        settingsRead: () => settings.read(),
        settingsWrite: (volume) => {
          const next = settings.write({ volume });
          playback.control.setVolume(next.volume, false);
          return next;
        },
        appearanceRead: () => appearanceOf(settings.read()),
        appearanceWrite: (patch) => {
          const next = settings.write(patch);
          pushAppearance();
          return appearanceOf(next);
        },
        librarySearch: (keywords) => loopbackJson(apiPort, "GET", `/search?keywords=${encodeURIComponent(keywords)}`),
        libraryPlaylistTracks: (id) => loopbackJson(apiPort, "GET", `/playlist/tracks?id=${encodeURIComponent(id)}`),
        libraryDaily: () => loopbackJson(apiPort, "GET", "/recommend/daily"),
        libraryRadar: () => loopbackJson(apiPort, "GET", "/recommend/radar"),
        libraryTideToday: () => loadTideToday(apiPort, listenLog.read()),
        librarySession: () => loopbackJson(apiPort, "GET", "/session"),
        sessionLogout: () => loopbackJson(apiPort, "POST", "/session/logout"),
      },
    });
    console.log(`[tide] command bus on 127.0.0.1:${commandServer.port}`);
  } catch (error) {
    console.error("[tide] command bus failed", error instanceof Error ? error.message : "error");
  }

  mainWindow = createWindow();

  const requestedPort = Number(process.env.TIDE_API_PORT ?? DEFAULT_API_PORT);
  const cookieFile = path.join(app.getPath("userData"), "netease.cookie");
  apiProcess = startApiProcess(
    serverBundlePath(),
    Number.isInteger(requestedPort) ? requestedPort : DEFAULT_API_PORT,
    {
      TIDE_COOKIE_FILE: cookieFile,
      TIDE_LIBRARY_FILE: path.join(app.getPath("userData"), "local-library.json"),
    },
  );
  try {
    const bound = await apiProcess.ready;
    if (quitting) return;
    apiPort = bound;
    console.log(`[tide] API ready on 127.0.0.1:${bound}`);
  } catch (error) {
    if (quitting) return;
    console.error("[tide] API failed to start", error);
  }

  if (quitting) return;
  await publishHealth();
  healthTimer = setInterval(() => {
    void publishHealth();
  }, 2000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  shutdown();
});

app.on("before-quit", () => {
  closeDesk();
  globalShortcut.unregisterAll();
  ipcMain.removeHandler(Ipc.qualityGet);
  ipcMain.removeHandler(Ipc.qualitySet);
  ipcMain.removeHandler(Ipc.mediaShortcutsGet);
  ipcMain.removeHandler(Ipc.mediaShortcutsSet);
  ipcMain.removeHandler(Ipc.captureMediaKeysSet);
  ipcMain.removeHandler(Ipc.hardwareKey);
  stopApi();
  const bus = commandServer;
  commandServer = null;
  void bus?.close();
  detachPlayback?.();
  detachPlayback = null;
  detachSession?.();
  detachSession = null;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
