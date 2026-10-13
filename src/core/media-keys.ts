/** OS media keys, WM_APPCOMMAND, and optional custom accelerators. */

export const MEDIA_SHORTCUTS = ["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack", "MediaStop"] as const;

export type MediaShortcut = (typeof MEDIA_SHORTCUTS)[number];

export type MediaAction = "toggle" | "play" | "pause" | "next" | "previous" | "stop";

export type MediaCustomAction = "toggle" | "next" | "previous" | "stop";

export const MEDIA_CUSTOM_ACTIONS: readonly MediaCustomAction[] = ["toggle", "next", "previous", "stop"];

export const MEDIA_ACTION_LABEL: Record<MediaCustomAction, string> = {
  toggle: "播放/暂停",
  next: "下一首",
  previous: "上一首",
  stop: "停止",
};

export const MEDIA_SESSION_ACTIONS = ["play", "pause", "nexttrack", "previoustrack", "stop"] as const;

export type MediaSessionAction = (typeof MEDIA_SESSION_ACTIONS)[number];

export type MediaSource = "shortcut" | "session" | "app-command";

export type HardwarePath = "shortcut" | "app-command" | "session";

/** Two deliveries of one physical press, including play then pause, collapse inside this window. */
export const MEDIA_DEDUPE_MS = 300;

export const WM_APPCOMMAND = 0x0319;

export interface MediaShortcutMap {
  toggle: string;
  next: string;
  previous: string;
  stop: string;
}

export const EMPTY_MEDIA_SHORTCUTS: MediaShortcutMap = {
  toggle: "",
  next: "",
  previous: "",
  stop: "",
};

export interface HardwareKeyState {
  focused: boolean;
  minimized: boolean;
  /** True after this process has started playback at least once. */
  playbackStarted: boolean;
}

/**
 * Electron's `navigator.mediaSession` does not receive VK_MEDIA_* when the
 * window is unfocused or minimized, and there is no Windows SMTC target until
 * something has played. Those states need `globalShortcut` instead.
 */
export function mediaSessionReceivesHardwareKey(state: HardwareKeyState): boolean {
  return state.focused && !state.minimized && state.playbackStarted;
}

/** Paths that can deliver one hardware press in this window state. Shortcut is always armed. */
export function hardwareKeyPaths(state: HardwareKeyState): HardwarePath[] {
  const paths: HardwarePath[] = ["shortcut"];
  if (state.focused && !state.minimized) paths.push("app-command");
  if (mediaSessionReceivesHardwareKey(state)) paths.push("session");
  return paths;
}

/**
 * Windows still installs mediaSession so the system media UI can call in.
 * That is not the only path: hardware keys also use globalShortcut and WM_APPCOMMAND.
 */
export function mediaKeyMode(platform: string): "session" | "shortcut" {
  return platform === "win32" ? "session" : "shortcut";
}

export function shortcutAction(accelerator: string): MediaAction | null {
  if (accelerator === "MediaPlayPause") return "toggle";
  if (accelerator === "MediaNextTrack") return "next";
  if (accelerator === "MediaPreviousTrack") return "previous";
  if (accelerator === "MediaStop") return "stop";
  return null;
}

const APP_COMMAND_CODE: Record<number, MediaAction> = {
  11: "next",
  12: "previous",
  13: "stop",
  14: "toggle",
  46: "play",
  47: "pause",
};

const APP_COMMAND_NAME: Record<string, MediaAction> = {
  "media-nexttrack": "next",
  "media-previoustrack": "previous",
  "media-play-pause": "toggle",
  "media-stop": "stop",
  "media-play": "play",
  "media-pause": "pause",
};

/** `GET_APPCOMMAND_LPARAM`: command in bits 16–27. Device flags in the top nibble are ignored. */
export function appCommandFromLParam(lParam: number): MediaAction | null {
  if (!Number.isFinite(lParam)) return null;
  const command = (lParam >>> 16) & 0x0fff;
  return APP_COMMAND_CODE[command] ?? null;
}

export function appCommandName(command: string): MediaAction | null {
  return APP_COMMAND_NAME[command] ?? null;
}

export function mediaSlot(action: string): "playpause" | "next" | "previous" | "stop" | null {
  if (action === "toggle" || action === "play" || action === "pause" || action === "playpause") return "playpause";
  if (action === "next" || action === "nexttrack") return "next";
  if (action === "previous" || action === "previoustrack") return "previous";
  if (action === "stop") return "stop";
  return null;
}

export function isMediaAction(value: unknown): value is MediaAction {
  return value === "toggle" || value === "play" || value === "pause" || value === "next" || value === "previous" || value === "stop";
}

/** Collapse every source of one press onto a single slot. A later different slot still runs. */
export function createMediaDeduper(windowMs = MEDIA_DEDUPE_MS): {
  accept(action: string, at: number): boolean;
} {
  let last: { slot: string; at: number } | null = null;
  return {
    accept(action, at) {
      const slot = mediaSlot(action);
      if (!slot || !Number.isFinite(at)) return false;
      if (last && last.slot === slot && at >= last.at && at - last.at < windowMs) return false;
      last = { slot, at };
      return true;
    },
  };
}

const MODIFIER_ALIAS: Record<string, string> = {
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  command: "Meta",
  cmd: "Meta",
  super: "Meta",
  meta: "Meta",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

const KEY_ALIAS: Record<string, string> = {
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  space: "Space",
  plus: "Plus",
  minus: "Minus",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  mediaplaypause: "MediaPlayPause",
  medianexttrack: "MediaNextTrack",
  mediaprevioustrack: "MediaPreviousTrack",
  mediastop: "MediaStop",
};

const MODIFIER_ORDER = ["CommandOrControl", "Ctrl", "Alt", "Shift", "Meta"];

function canonicalKey(token: string): string | null {
  const lower = token.toLowerCase();
  if (KEY_ALIAS[lower]) return KEY_ALIAS[lower];
  if (/^f([1-9]|1[0-2])$/.test(lower)) return `F${lower.slice(1)}`;
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  return null;
}

/** A custom combo needs a modifier, so a bare letter is not stolen from typing. */
export function normalizeAccelerator(input: string): string | null {
  const parts = input.trim().split("+").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 2 || parts.length > 5) return null;
  const modifiers: string[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIAS[part.toLowerCase()];
    if (modifier) {
      if (modifiers.includes(modifier)) return null;
      modifiers.push(modifier);
      continue;
    }
    if (key) return null;
    key = canonicalKey(part);
    if (!key) return null;
  }
  if (!key || modifiers.length === 0) return null;
  modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right));
  return [...modifiers, key].join("+");
}

export function isBuiltinMediaAccelerator(accelerator: string): boolean {
  return (MEDIA_SHORTCUTS as readonly string[]).includes(accelerator);
}

export function mediaShortcutsFromUnknown(value: unknown): MediaShortcutMap {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const read = (key: MediaCustomAction) => (
    typeof record[key] === "string" ? record[key].trim().slice(0, 64) : ""
  );
  return {
    toggle: read("toggle"),
    next: read("next"),
    previous: read("previous"),
    stop: read("stop"),
  };
}

export interface ShortcutRegistration {
  action: MediaCustomAction;
  accelerator: string;
}

/** Validate and reject internal clashes. `register` reports whether the OS accepted the combo. */
export function planCustomShortcuts(desired: MediaShortcutMap): {
  register: ShortcutRegistration[];
  messages: string[];
} {
  const register: ShortcutRegistration[] = [];
  const messages: string[] = [];
  const used = new Map<string, MediaCustomAction>();
  for (const action of MEDIA_CUSTOM_ACTIONS) {
    const raw = desired[action].trim();
    if (raw.length === 0) continue;
    const label = MEDIA_ACTION_LABEL[action];
    if ((MEDIA_SHORTCUTS as readonly string[]).some((name) => name.toLowerCase() === raw.toLowerCase())) {
      messages.push(`${label}不用再设媒体键，系统媒体键已经可用。`);
      continue;
    }
    const accelerator = normalizeAccelerator(raw);
    if (!accelerator) {
      messages.push(`${label}的组合无效。请写成 Ctrl+Alt+Right 这种带修饰键的形式。`);
      continue;
    }
    if (isBuiltinMediaAccelerator(accelerator)) {
      messages.push(`${label}不用再设媒体键，系统媒体键已经可用。`);
      continue;
    }
    const owner = used.get(accelerator);
    if (owner) {
      messages.push(`${accelerator} 已经用于${MEDIA_ACTION_LABEL[owner]}。`);
      continue;
    }
    used.set(accelerator, action);
    register.push({ action, accelerator });
  }
  return { register, messages };
}

export function applyShortcutPlan(
  plan: { register: ShortcutRegistration[]; messages: string[] },
  register: (accelerator: string) => boolean,
): { saved: MediaShortcutMap; messages: string[] } {
  const saved: MediaShortcutMap = { ...EMPTY_MEDIA_SHORTCUTS };
  const messages = [...plan.messages];
  for (const item of plan.register) {
    let ok = false;
    try {
      ok = register(item.accelerator);
    } catch {
      ok = false;
    }
    if (!ok) {
      messages.push(`${item.accelerator} 已被占用，${MEDIA_ACTION_LABEL[item.action]}没有生效。`);
      continue;
    }
    saved[item.action] = item.accelerator;
  }
  return { saved, messages };
}
