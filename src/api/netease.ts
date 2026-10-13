import path from "node:path";
import { createRequire } from "node:module";
import type { PlaylistSummary, SessionUser } from "../shared/contract";

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
}

export interface QrImage {
  qrurl: string;
  qrimg: string;
}

export interface QrPoll {
  code: number;
  cookie: string | null;
}

/** Calls into the pinned NeteaseCloudMusicApi package. No HTTP surface of its own. */
export interface NeteaseClient {
  qrKey(): Promise<string>;
  qrImage(key: string): Promise<QrImage>;
  qrCheck(key: string): Promise<QrPoll>;
  loginStatus(cookie: string): Promise<SessionUser | null>;
  playlists(cookie: string, uid: string): Promise<PlaylistSummary[]>;
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

export function readQrCheck(result: NcmResult): QrPoll {
  const code = result.body?.code;
  if (typeof code !== "number") throw new Error("qr_check_failed");
  const fromBody = typeof result.body?.cookie === "string" ? result.body.cookie : "";
  const fromList = Array.isArray(result.cookie) ? result.cookie.join(";") : "";
  const cookie = fromBody || fromList;
  return { code, cookie: cookie.length > 0 ? cookie : null };
}

function loadNeteaseModule(): NcmModule {
  // The bundled server is dist/api/server.js, so the repo package.json is two levels up.
  const entry = process.argv[1];
  if (!entry) throw new Error("netease module path missing");
  const require = createRequire(path.join(path.dirname(entry), "..", "..", "package.json"));
  return require("NeteaseCloudMusicApi") as NcmModule;
}
