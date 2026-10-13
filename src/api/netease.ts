import path from "node:path";
import { createRequire } from "node:module";
import type { PlaylistSummary, SearchHit, SessionUser } from "../shared/contract";

interface NcmBody {
  code?: number;
  cookie?: string;
  message?: string;
  data?: {
    code?: number;
    unikey?: string;
    qrurl?: string;
    qrimg?: string;
    account?: { id?: number; anonimousUser?: boolean };
    profile?: { userId?: number; nickname?: string };
  };
  playlist?: NcmPlaylist[];
}

interface NcmPlaylist {
  id?: number | string;
  name?: string;
  trackCount?: number;
}

interface NcmResult {
  body?: NcmBody;
  cookie?: string[];
}

interface NcmModule {
  login_qr_key(query: { cookie?: string }): Promise<NcmResult>;
  login_qr_create(query: { key: string; qrimg?: boolean; cookie?: string }): Promise<NcmResult>;
  login_qr_check(query: { key: string; cookie?: string }): Promise<NcmResult>;
  login_status(query: { cookie?: string }): Promise<NcmResult>;
  user_playlist(query: { uid: string; limit?: number; cookie?: string }): Promise<NcmResult>;
  cloudsearch(query: { keywords: string; type?: number; limit?: number; cookie?: string }): Promise<unknown>;
  song_url(query: { id: string; br?: number; cookie?: string }): Promise<unknown>;
}

export interface QrImage {
  qrurl: string;
  qrimg: string;
}

export interface QrPoll {
  code: number;
  cookie: string | null;
}

export interface SongMedia {
  url: string | null;
  signedOut: boolean;
}

/** Calls into the pinned NeteaseCloudMusicApi package. No HTTP surface of its own. */
export interface NeteaseClient {
  qrKey(): Promise<string>;
  qrImage(key: string): Promise<QrImage>;
  qrCheck(key: string): Promise<QrPoll>;
  loginStatus(cookie: string): Promise<SessionUser | null>;
  playlists(cookie: string, uid: string): Promise<PlaylistSummary[]>;
  search(keywords: string, cookie: string | null): Promise<SearchHit[]>;
  songUrl(id: string, cookie: string | null): Promise<SongMedia>;
}

export function createNeteaseClient(module: NcmModule = loadNeteaseModule()): NeteaseClient {
  return {
    async qrKey() {
      return readQrKey(await module.login_qr_key({}));
    },
    async qrImage(key) {
      return readQrImage(await module.login_qr_create({ key, qrimg: true }));
    },
    async qrCheck(key) {
      return readQrCheck(await module.login_qr_check({ key }));
    },
    async loginStatus(cookie) {
      return readUser(await module.login_status({ cookie }));
    },
    async playlists(cookie, uid) {
      return readPlaylists(await module.user_playlist({ uid, cookie, limit: 100 }));
    },
    async search(keywords, cookie) {
      return readSearch(await module.cloudsearch(withCookie({ keywords, type: 1, limit: 20 }, cookie)));
    },
    async songUrl(id, cookie) {
      return readSongUrl(await module.song_url(withCookie({ id, br: 128000 }, cookie)));
    },
  };
}

export function readUser(result: NcmResult): SessionUser | null {
  const data = result.body?.data;
  if (!data || data.code !== 200 || data.account?.anonimousUser) return null;
  const id = data.profile?.userId ?? data.account?.id;
  if (id == null) return null;
  const nickname = data.profile?.nickname?.trim();
  return { id: String(id), nickname: nickname && nickname.length > 0 ? nickname : "网易云用户" };
}

export function readPlaylists(result: NcmResult): PlaylistSummary[] {
  if (result.body?.code !== 200 || !Array.isArray(result.body.playlist)) {
    throw new Error("playlist_failed");
  }
  const playlists: PlaylistSummary[] = [];
  for (const item of result.body.playlist) {
    if (item.id == null || typeof item.name !== "string" || item.name.trim().length === 0) continue;
    const trackCount = typeof item.trackCount === "number" && Number.isFinite(item.trackCount)
      ? Math.max(0, Math.trunc(item.trackCount))
      : 0;
    playlists.push({ id: String(item.id), name: item.name.trim().slice(0, 200), trackCount });
    if (playlists.length >= 100) break;
  }
  return playlists;
}

export function readQrKey(result: NcmResult): string {
  const unikey = result.body?.data?.unikey;
  if (typeof unikey !== "string" || unikey.length === 0) throw new Error("qr_key_failed");
  return unikey;
}

export function readQrImage(result: NcmResult): QrImage {
  const qrurl = result.body?.data?.qrurl;
  const qrimg = result.body?.data?.qrimg;
  if (typeof qrurl !== "string" || !qrurl.startsWith("https://music.163.com/login?codekey=")) {
    throw new Error("qr_image_failed");
  }
  if (typeof qrimg !== "string" || !qrimg.startsWith("data:image/")) throw new Error("qr_image_failed");
  return { qrurl, qrimg };
}

const MAX_HITS = 20;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function readSearch(result: unknown): SearchHit[] {
  const body = asRecord(asRecord(result)?.body);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code !== 200) throw new Error("search_failed");
  const songs = asRecord(body?.result)?.songs;
  if (!Array.isArray(songs)) return [];
  const hits: SearchHit[] = [];
  for (const item of songs) {
    const song = asRecord(item);
    if (!song) continue;
    const id = song.id == null ? "" : String(song.id);
    const name = typeof song.name === "string" ? song.name.trim() : "";
    if (!/^\d{1,20}$/.test(id) || name.length === 0) continue;
    const privilege = asRecord(song.privilege);
    const st = asNumber(privilege?.st);
    const pl = asNumber(privilege?.pl);
    const duration = asNumber(song.dt);
    hits.push({
      id,
      title: name.slice(0, 200),
      artist: readArtists(song.ar),
      durationMs: duration == null ? 0 : Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(duration))),
      playable: st != null && st >= 0 && pl != null && pl > 0,
    });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

export function readSongUrl(result: unknown): SongMedia {
  const body = asRecord(asRecord(result)?.body);
  if (asNumber(body?.code) === 301) return { url: null, signedOut: true };
  const data = body?.data;
  const item = Array.isArray(data) ? asRecord(data[0]) : null;
  const url = item?.url;
  if (asNumber(item?.code) === 404 || typeof url !== "string" || !isHttpUrl(url)) {
    return { url: null, signedOut: false };
  }
  return { url, signedOut: false };
}

export function readQrCheck(result: NcmResult): QrPoll {
  const code = result.body?.code;
  if (typeof code !== "number") throw new Error("qr_check_failed");
  const fromBody = typeof result.body?.cookie === "string" ? result.body.cookie : "";
  const fromList = Array.isArray(result.cookie) ? result.cookie.join(";") : "";
  const cookie = fromBody || fromList;
  return { code, cookie: cookie.length > 0 ? cookie : null };
}

function readArtists(value: unknown): string {
  if (!Array.isArray(value)) return "未知";
  const names: string[] = [];
  for (const item of value) {
    const name = asRecord(item)?.name;
    if (typeof name === "string" && name.trim().length > 0) names.push(name.trim());
  }
  const joined = names.join(" / ");
  return joined.length > 0 ? joined.slice(0, 200) : "未知";
}

function withCookie<T extends object>(query: T, cookie: string | null): T & { cookie?: string } {
  return cookie ? { ...query, cookie } : query;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function loadNeteaseModule(): NcmModule {
  // The bundled server is dist/api/server.js, so the repo package.json is two levels up.
  const entry = process.argv[1];
  if (!entry) throw new Error("netease module path missing");
  const require = createRequire(path.join(path.dirname(entry), "..", "..", "package.json"));
  return require("NeteaseCloudMusicApi") as NcmModule;
}
