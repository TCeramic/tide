import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import path from "node:path";
import { isAudioLevel } from "../core/audio-level";
import { MEDIA_SHORTCUTS, mediaKeyMode, shortcutAction } from "../core/media-keys";
import { PlaybackMachine } from "../core/playback/machine";
import { DEFAULT_API_PORT, DEFAULT_BUS_PORT, Ipc, type Appearance, type HealthStatus } from "../shared/contract";
import { checkHealth, serverBundlePath, startApiProcess, type ApiProcess } from "./api-host";
import { BusAllowStore, BusTokenStore } from "./bus-files";
import { startCommandServer, type RunningCommandServer } from "./command-server";
import { ListenLog } from "./listen-log";
import { attachPlayback } from "./playback-host";
import { attachSession, loopbackJson } from "./session-host";
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

const machine = new PlaybackMachine();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: "#071018",
    title: "潮汐 Tide",
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
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-finish-load", () => {
    win.webContents.send(Ipc.playback, machine.getState());
    const current = settingsStore?.read();
    if (current) win.webContents.send(Ipc.appearance, appearanceOf(current));
    void publishHealth();
  });

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
  const listenLog = new ListenLog(path.join(app.getPath("userData"), "listen-log.json"));
  machine.setVolume(settings.read().volume);
  const playback = attachPlayback(() => mainWindow, machine, () => apiPort, (volume) => {
    settings.write({ volume });
  }, listenLog, () => settings.read().quality);
  ipcMain.handle(Ipc.qualityGet, () => settings.read().quality);
  ipcMain.handle(Ipc.qualitySet, (_event, level: unknown) => {
    if (!isAudioLevel(level)) return settings.read().quality;
    return settings.write({ quality: level }).quality;
  });
  if (mediaKeyMode(process.platform) === "shortcut") {
    for (const accelerator of MEDIA_SHORTCUTS) {
      const action = shortcutAction(accelerator);
      if (!action) continue;
      try {
        globalShortcut.register(accelerator, () => {
          if (action === "toggle") {
            if (machine.getState().status === "playing") playback.control.pause();
            else void playback.control.play();
            return;
          }
          if (action === "next") void playback.control.next();
          else void playback.control.previous();
        });
      } catch {
        // This OS may not expose the media key. The in-window bar still works.
      }
    }
  }
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
    { TIDE_COOKIE_FILE: cookieFile },
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
  globalShortcut.unregisterAll();
  ipcMain.removeHandler(Ipc.qualityGet);
  ipcMain.removeHandler(Ipc.qualitySet);
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
