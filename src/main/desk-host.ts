import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import {
  fitDeskBounds,
  clampDeskOrigin,
  deskSettingsFromUnknown,
  deskWindowSize,
  type DeskLyricsSettings,
} from "../core/desk-lyrics";
import { performanceBudget } from "../core/performance";
import { desktopLyricContent, type LyricLine } from "../core/lyrics";
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
 * Desktop lyrics overlay. The window and cue timer exist only while enabled.
 * The one visibility shortcut stays registered so it can reopen a hidden overlay.
 */
export function attachDeskLyrics(options: {
  settings: SettingsStore;
  machine: PlaybackMachine;
  getMainWindow: () => BrowserWindow | null;
  notify: (message: string) => void;
}): { close: () => void;getCue:()=>DeskCue } {
  let overlay: BrowserWindow | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let registeredShortcut = "";
  let contextMenu: BrowserWindow | null = null;
  let anchor: {x:number;y:number} | null = null;
  let programmaticBounds: {x:number;y:number;width:number;height:number} | null = null;
  let bundle = { ...EMPTY_BUNDLE };
  let seenMs = 0;
  let seenAt = 0;
  let seenTrack = "";
  let lastPayload = "";

  const read = () => options.settings.read().deskLyrics;

  const publishState = (settings: DeskLyricsSettings) => {
    for(const win of [options.getMainWindow(),overlay,contextMenu]) if(win&&!win.isDestroyed())win.webContents.send(Ipc.deskState,settings);
  };

  const areas = () => screen.getAllDisplays().map((display) => display.workArea);

  const estimatePosition = () => {
    const state = options.machine.nowPlaying();
    const now = Date.now();
    const id=state.track?.id??"";
    if (!seenAt || seenTrack!==id || state.status !== "playing" || state.positionMs !== seenMs) {
      seenTrack=id;
      seenMs = state.positionMs;
      seenAt = now;
      return state.positionMs;
    }
    return seenMs + (now - seenAt);
  };

  const cueNow = (): DeskCue => {
    const settings = read();
    const budget = performanceBudget(options.settings.read().performance);
    const state = options.machine.nowPlaying();
    const track = state.track??undefined;
    const same = Boolean(track && track.id === bundle.trackId);
    const display = desktopLyricContent(same?bundle.yrc:[],same?bundle.original:[],same?bundle.translation:[],estimatePosition(),same?bundle.offsetMs:0,track?.title??"",track?.artist??"");
    const text=display.text, translation=settings.pair||display.metadata?display.translation:"";
    const follow=settings.highlightFollow&&!display.metadata;
    return {
      title: track?.title??"",
      artist: track?.artist??"",
      metadata: display.metadata,
      next: display.next,
      lineMode: settings.lineMode,
      text,
      translation,
      progress: follow ? display.progress : 0,
      wordLevel: follow && display.wordLevel,
      highlightFollow: follow,
      playing: state.status === "playing",
      fontSize: settings.fontSize,
      color: settings.color,
      highlightColor: settings.highlightColor,
      fontFamily: settings.fontFamily,
      opacity: settings.opacity,
      glow: budget.deskFarGlow ? settings.glow : Math.min(settings.glow, 0.35),
      motion: settings.motion && budget.deskFps > 30,
      pair: settings.pair,
      wave: settings.wave && budget.deskFarGlow,
      farGlow: budget.deskFarGlow,
      empty: text.length === 0,
      orientation: settings.orientation,
      motionLevel: settings.motionLevel,
      backdrop: settings.backdrop,
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

  const armShortcut = (_open?: boolean) => {
    const accelerator=read().toggleShortcut;
    if(accelerator===registeredShortcut)return;
    if(registeredShortcut)globalShortcut.unregister(registeredShortcut);
    registeredShortcut="";
    if(!accelerator)return;
    try { if(globalShortcut.register(accelerator,()=>apply({open:!read().open})))registeredShortcut=accelerator; }
    catch { /* Report a collision or unsupported accelerator below. */ }
    if(!registeredShortcut)options.notify("桌面歌词显隐热键未能注册，请在设置中更换。");
  };
  const closeContext = () => {const win=contextMenu;contextMenu=null;if(win&&!win.isDestroyed())win.destroy();};
  const openContext = () => {
    if(!overlay||overlay.isDestroyed()||read().locked)return;
    closeContext();
    const cursor=screen.getCursorScreenPoint(),area=screen.getDisplayNearestPoint(cursor).workArea;
    const look=options.settings.read(),width=Math.min(320,area.width),height=Math.min(520,area.height);
    const win=new BrowserWindow({width,height,x:Math.max(area.x,Math.min(cursor.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(cursor.y,area.y+area.height-height)),frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,resizable:false,show:false,backgroundColor:"#00000000",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    contextMenu=win;win.setAlwaysOnTop(true,"screen-saver");
    win.once("ready-to-show",()=>{if(contextMenu===win){win.show();win.focus();}});
    win.on("blur",()=>{setTimeout(()=>{if(contextMenu===win&&!win.isDestroyed()&&!win.isFocused())closeContext();},80);});
    win.on("closed",()=>{if(contextMenu===win)contextMenu=null;});
    void win.loadFile(path.join(__dirname,"desk.html"),{query:{context:"true",shell:look.shell,mode:(look.shell==="lattice"?look.latticeMode:look.lensMode)??"dark"}});
  };

  const applyLock = (settings: DeskLyricsSettings) => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.setIgnoreMouseEvents(settings.locked,{forward:true});
  };

  const destroyOverlay = () => {
    stopTimer();
    closeContext();
    lastPayload = "";
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = null;
    const win = overlay;
    overlay = null;
    if (win && !win.isDestroyed()) win.destroy();
  };

  const onMoved = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const bounds=overlay.getBounds(),{x,y}=bounds;
    if(programmaticBounds&&["x","y","width","height"].every(k=>Math.abs(bounds[k as keyof typeof bounds]-programmaticBounds![k as keyof typeof bounds])<=1))return;
    programmaticBounds=null;anchor={x:x+bounds.width/2,y:y+bounds.height/2};
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const next = deskSettingsFromUnknown({ ...read(), x, y });
      options.settings.write({ deskLyrics: next });
      publishState(next);
    }, 180);
  };

  const ensure = (settings: DeskLyricsSettings) => {
    if (overlay && !overlay.isDestroyed()) {
      const size = deskWindowSize(settings.fontSize, settings.pair, settings.orientation, settings.lineMode==="double");
      const bounds = overlay.getBounds();
      if(!programmaticBounds||Math.abs(bounds.x-programmaticBounds.x)>2||Math.abs(bounds.y-programmaticBounds.y)>2)anchor={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
      if (Math.abs(bounds.width-size.width)>1 || Math.abs(bounds.height-size.height)>1) {
        anchor??={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
        if(moveTimer)clearTimeout(moveTimer);moveTimer=null;
        programmaticBounds=fitDeskBounds(anchor,size,areas());overlay.setBounds(programmaticBounds);
        options.settings.write({deskLyrics:{...settings,x:programmaticBounds.x,y:programmaticBounds.y}});
      }
      applyLock(settings);
      return;
    }
    const size = deskWindowSize(settings.fontSize, settings.pair, settings.orientation, settings.lineMode==="double");
    const origin = clampDeskOrigin(
      settings.x == null || settings.y == null ? null : { x: settings.x, y: settings.y },
      areas(),
      size,
    );
    anchor={x:origin.x+size.width/2,y:origin.y+size.height/2};
    const fitted=fitDeskBounds(anchor,size,areas());
    const win = new BrowserWindow({
      ...fitted,
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
    win.on("move", onMoved);
    win.on("system-context-menu",event=>{event.preventDefault();openContext();});
    win.once("ready-to-show", () => {
      if (overlay !== win || win.isDestroyed()) return;
      win.showInactive();
      applyLock(read());
      lastPayload = ""; // Replay the initial cue after the overlay subscribes.
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
    const size = deskWindowSize(settings.fontSize, settings.pair, settings.orientation, settings.lineMode==="double");
    const fitted=fitDeskBounds({x:x+size.width/2,y:y+size.height/2},size,areas());
    const origin={x:fitted.x,y:fitted.y};
    if (origin.x !== x || origin.y !== y) overlay.setPosition(origin.x, origin.y);
  };

  screen.on("display-removed", reclamp);
  screen.on("display-metrics-changed", reclamp);

  ipcMain.handle(Ipc.deskCenter,()=>{if(!overlay||overlay.isDestroyed())return;const b=overlay.getBounds(),area=screen.getDisplayMatching(b).workArea;const vertical=read().orientation==="vertical";
    const next={...b,x:vertical?b.x:Math.round(area.x+(area.width-b.width)/2),y:vertical?Math.round(area.y+(area.height-b.height)/2):b.y};programmaticBounds=next;anchor={x:next.x+b.width/2,y:next.y+b.height/2};overlay.setBounds(next);options.settings.write({deskLyrics:{...read(),x:next.x,y:next.y}});
  });
  ipcMain.handle(Ipc.deskContext,event=>{if(event.sender===overlay?.webContents)openContext();});
  ipcMain.handle(Ipc.deskContextClose,event=>{if(event.sender===contextMenu?.webContents||event.sender===overlay?.webContents)closeContext();});
  ipcMain.handle("tide:desk-interactive",(event,interactive:unknown)=>{if(overlay&&event.sender===overlay.webContents&&read().locked)overlay.setIgnoreMouseEvents(interactive!==true,{forward:true});});
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
  else armShortcut();

  return {
    getCue:cueNow,
    close() {
      screen.removeListener("display-removed", reclamp);
      screen.removeListener("display-metrics-changed", reclamp);
      ipcMain.removeHandler("tide:desk-interactive");
      ipcMain.removeHandler(Ipc.deskCenter);
      ipcMain.removeHandler(Ipc.deskContext);
      ipcMain.removeHandler(Ipc.deskContextClose);
      ipcMain.removeHandler(Ipc.deskGet);
      ipcMain.removeHandler(Ipc.deskSet);
      ipcMain.removeAllListeners(Ipc.deskLines);
      if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
      registeredShortcut = "";
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
