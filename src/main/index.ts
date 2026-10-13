import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { PlaybackMachine } from "../core/playback/machine";
import { DEFAULT_API_PORT, Ipc, type HealthStatus } from "../shared/contract";
import { checkHealth, serverBundlePath, startApiProcess, type ApiProcess } from "./api-host";
import { attachPlayback } from "./playback-host";
import { attachSession } from "./session-host";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow: BrowserWindow | null = null;
let apiProcess: ApiProcess | null = null;
let apiPort: number | null = null;
let detachPlayback: (() => void) | null = null;
let detachSession: (() => void) | null = null;
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
    void publishHealth();
  });

  void win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

async function publishHealth(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const status: HealthStatus = apiPort == null
    ? { ok: false, error: "stopped" }
    : await checkHealth(apiPort);
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

function shutdown(): void {
  if (quitting) return;
  quitting = true;
  stopApi();
  detachPlayback?.();
  detachPlayback = null;
  detachSession?.();
  detachSession = null;
  app.quit();
}

app.whenReady().then(async () => {
  ipcMain.handle(Ipc.healthGet, () =>
    apiPort == null
      ? Promise.resolve({ ok: false, error: "stopped" } satisfies HealthStatus)
      : checkHealth(apiPort),
  );

  detachPlayback = attachPlayback(() => mainWindow, machine, () => apiPort);
  detachSession = attachSession(() => apiPort);

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
  stopApi();
  detachPlayback?.();
  detachPlayback = null;
  detachSession?.();
  detachSession = null;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
