import crypto from "node:crypto";

export const COMMANDS = [
  "playback.get",
  "playback.play",
  "playback.pause",
  "playback.seek",
  "playback.volume",
  "playback.next",
  "playback.prev",
  "playback.queue",
  "playback.playHits",
  "playback.mode",
  "settings.read",
  "settings.write",
  "appearance.read",
  "appearance.write",
  "library.search",
  "library.playlistTracks",
  "library.daily",
  "library.radar",
  "library.tideToday",
  "library.session",
  "session.logout",
  "session.clearCookie",
  "playlist.organize",
] as const;

export type CommandName = (typeof COMMANDS)[number];

/** Writes and NetEase mutations. Safe reads and playback transport are not in this list. */
export const DANGEROUS_COMMANDS = [
  "settings.write",
  "appearance.write",
  "session.logout",
  "session.clearCookie",
  "playlist.organize",
] as const;

export type CommandErrorCode =
  | "unauthorized"
  | "denied"
  | "unsupported"
  | "bad_command"
  | "bad_args"
  | "upstream";

export interface CommandSuccess {
  ok: true;
  command: CommandName;
  result: unknown;
}

export interface CommandFailure {
  ok: false;
  command: string | null;
  error: CommandErrorCode;
  message: string;
}

export type CommandResult = CommandSuccess | CommandFailure;

const COMMAND_SET = new Set<string>(COMMANDS);
const DANGEROUS_SET = new Set<string>(DANGEROUS_COMMANDS);

export function isCommandName(value: string): value is CommandName {
  return COMMAND_SET.has(value);
}

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_SET.has(command);
}

/**
 * A dangerous command runs only when this request sets `allow: true` (or lists the command)
 * or the userData whitelist contains it.
 */
export function commandPermitted(command: string, requestAllow: unknown, whitelist: readonly string[]): boolean {
  if (!isDangerousCommand(command)) return true;
  if (requestAllow === true) return true;
  if (Array.isArray(requestAllow) && requestAllow.some((item) => item === command)) return true;
  return whitelist.includes(command);
}

export function allowListFromUnknown(value: unknown): string[] {
  const allow = value && typeof value === "object" ? (value as { allow?: unknown }).allow : undefined;
  if (!Array.isArray(allow)) return [];
  const names: string[] = [];
  for (const item of allow) {
    if (typeof item === "string" && isDangerousCommand(item) && !names.includes(item)) names.push(item);
  }
  return names;
}

export function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Drop cookie-like fields and any string that carries a NetEase session cookie. */
export function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.includes("MUSIC_U") ? "" : value;
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "cookie") continue;
    clean[key] = scrub(item);
  }
  return clean;
}

export function failure(command: string | null, error: CommandErrorCode, message: string): CommandFailure {
  return { ok: false, command, error, message };
}
