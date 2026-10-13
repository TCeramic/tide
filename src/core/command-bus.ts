import { isThemeId, type Appearance, type SearchHit, type Track } from "../shared/contract";
import {
  commandPermitted,
  failure,
  isCommandName,
  scrub,
  type CommandName,
  type CommandResult,
} from "../shared/commands";

export interface CommandHost {
  playbackGet(): Promise<unknown> | unknown;
  playbackPlay(): Promise<unknown> | unknown;
  playbackPause(): Promise<unknown> | unknown;
  playbackSeek(positionMs: number): Promise<unknown> | unknown;
  playbackVolume(volume: number): Promise<unknown> | unknown;
  playbackNext(): Promise<unknown> | unknown;
  playbackPrev(): Promise<unknown> | unknown;
  playbackQueue(queue: Track[], index?: number): Promise<unknown> | unknown;
  playbackPlayHits(hits: SearchHit[], index: number): Promise<unknown> | unknown;
  settingsRead(): Promise<unknown> | unknown;
  settingsWrite(volume: number): Promise<unknown> | unknown;
  appearanceRead(): Promise<unknown> | unknown;
  appearanceWrite(patch: Partial<Appearance>): Promise<unknown> | unknown;
  librarySearch(keywords: string): Promise<unknown> | unknown;
  libraryPlaylistTracks(id: string): Promise<unknown> | unknown;
  libraryDaily(): Promise<unknown> | unknown;
  libraryRadar(): Promise<unknown> | unknown;
  libraryTideToday(): Promise<unknown> | unknown;
  librarySession(): Promise<unknown> | unknown;
  sessionLogout(): Promise<unknown> | unknown;
}

export async function dispatchCommand(
  request: unknown,
  host: CommandHost,
  whitelist: readonly string[] = [],
): Promise<CommandResult> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return failure(null, "bad_command", "没有这条指令");
  }
  const body = request as { command?: unknown; args?: unknown; allow?: unknown };
  if (typeof body.command !== "string" || !isCommandName(body.command)) {
    return failure(typeof body.command === "string" ? body.command : null, "bad_command", "没有这条指令");
  }
  const command = body.command;
  if (!commandPermitted(command, body.allow, whitelist)) {
    return failure(command, "denied", "这个操作默认关闭。请求里加上 allow，或写入 bus-allow.json。");
  }
  if (command === "playlist.organize") {
    return failure(command, "unsupported", "潮汐不能修改网易云上的歌单，只能读取。");
  }
  try {
    const result = await run(command, body.args, host);
    if (result === null) return failure(command, "bad_args", "指令参数不正确");
    return { ok: true, command, result: scrub(result) };
  } catch {
    return failure(command, "upstream", "指令没有完成");
  }
}

async function run(command: CommandName, args: unknown, host: CommandHost): Promise<unknown | null> {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : {};
  switch (command) {
    case "playback.get":
      return host.playbackGet();
    case "playback.play":
      return host.playbackPlay();
    case "playback.pause":
      return host.playbackPause();
    case "playback.seek":
      if (typeof record.positionMs !== "number") return null;
      return host.playbackSeek(record.positionMs);
    case "playback.volume":
      if (typeof record.volume !== "number") return null;
      return host.playbackVolume(record.volume);
    case "playback.next":
      return host.playbackNext();
    case "playback.prev":
      return host.playbackPrev();
    case "playback.queue":
      return readQueue(record, host);
    case "playback.playHits":
      return readHits(record, host);
    case "settings.read":
      return host.settingsRead();
    case "settings.write":
      if (typeof record.volume !== "number" || !Number.isFinite(record.volume)) return null;
      return host.settingsWrite(record.volume);
    case "appearance.read":
      return host.appearanceRead();
    case "appearance.write":
      return readAppearance(record, host);
    case "library.search":
      if (typeof record.keywords !== "string" || record.keywords.trim().length === 0) return null;
      return host.librarySearch(record.keywords.trim().slice(0, 80));
    case "library.playlistTracks":
      if (typeof record.id !== "string" || !/^\d{1,20}$/.test(record.id)) return null;
      return host.libraryPlaylistTracks(record.id);
    case "library.daily":
      return host.libraryDaily();
    case "library.radar":
      return host.libraryRadar();
    case "library.tideToday":
      return host.libraryTideToday();
    case "library.session":
      return host.librarySession();
    case "session.logout":
    case "session.clearCookie":
      return host.sessionLogout();
    case "playlist.organize":
      return null;
    default:
      return null;
  }
}

async function readQueue(record: Record<string, unknown>, host: CommandHost): Promise<unknown | null> {
  if (!Array.isArray(record.queue)) return null;
  const tracks: Track[] = [];
  for (const item of record.queue) {
    const track = readTrack(item);
    if (!track) return null;
    tracks.push(track);
  }
  const index = record.index;
  if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index))) return null;
  return host.playbackQueue(tracks, index as number | undefined);
}

async function readHits(record: Record<string, unknown>, host: CommandHost): Promise<unknown | null> {
  if (!Array.isArray(record.hits) || typeof record.index !== "number") return null;
  const hits: SearchHit[] = [];
  for (const item of record.hits) {
    const hit = readHit(item);
    if (!hit) return null;
    hits.push(hit);
  }
  return host.playbackPlayHits(hits, record.index);
}

function readAppearance(record: Record<string, unknown>, host: CommandHost): Promise<unknown> | unknown | null {
  const patch: Partial<Appearance> = {};
  if ("chromeVisible" in record) {
    if (typeof record.chromeVisible !== "boolean") return null;
    patch.chromeVisible = record.chromeVisible;
  }
  if ("stageLevel" in record) {
    if (typeof record.stageLevel !== "number" || !Number.isFinite(record.stageLevel)) return null;
    patch.stageLevel = record.stageLevel;
  }
  if ("theme" in record) {
    if (!isThemeId(record.theme)) return null;
    patch.theme = record.theme;
  }
  if ("motion" in record) {
    if (typeof record.motion !== "number" || !Number.isFinite(record.motion)) return null;
    patch.motion = record.motion;
  }
  if (
    patch.chromeVisible === undefined
    && patch.stageLevel === undefined
    && patch.theme === undefined
    && patch.motion === undefined
  ) return null;
  return host.appearanceWrite(patch);
}

function readTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > 300) return null;
  if (typeof candidate.title !== "string" || candidate.title.length === 0 || candidate.title.length > 300) return null;
  if (typeof candidate.artist !== "string" || candidate.artist.length === 0 || candidate.artist.length > 300) return null;
  if (typeof candidate.durationMs !== "number" || !Number.isFinite(candidate.durationMs)) return null;
  if (candidate.durationMs < 0 || candidate.durationMs > 24 * 60 * 60 * 1000) return null;
  return {
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artist,
    durationMs: candidate.durationMs,
  };
}

function readHit(value: unknown): SearchHit | null {
  const track = readTrack(value);
  if (!track || !value || typeof value !== "object") return null;
  const playable = (value as { playable?: unknown }).playable;
  if (typeof playable !== "boolean" || !/^\d{1,20}$/.test(track.id)) return null;
  return { ...track, durationMs: Math.trunc(track.durationMs), playable };
}
