import path from "node:path";
import { createRequire } from "node:module";
import { loadPlaylistPages } from "../core/playlist-pages";
import type { AlbumSummary, ArtistSummary, PlaylistSummary, SearchHit, SessionUser } from "../shared/contract";

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
  specialType?: number;
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
  playlist_track_all(query: { id: string; limit?: number; cookie?: string }): Promise<unknown>;
  recommend_songs(query: { cookie?: string }): Promise<unknown>;
  recommend_resource(query: { cookie?: string }): Promise<unknown>;
  simi_song(query: { id: string; limit?: number; cookie?: string }): Promise<unknown>;
  lyric(query: { id: string; cookie?: string }): Promise<unknown>;
  like(query: { id: string; like: boolean; cookie?: string }): Promise<unknown>;
  playlist_tracks(query: { op: "add" | "del"; pid: string; tracks: string; cookie?: string }): Promise<unknown>;
  artist_songs(query: { id: string; limit?: number; cookie?: string }): Promise<unknown>;
  album(query: { id: string; cookie?: string }): Promise<unknown>;
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
  playlistTracks(id: string, cookie: string): Promise<SearchHit[]>;
  dailySongs(cookie: string): Promise<SearchHit[]>;
  radarId(cookie: string): Promise<string>;
  /** Similar songs via `simi_song`. Not daily recommend and not 私人雷达. */
  similarSongs(id: string, cookie: string | null): Promise<SearchHit[]>;
  searchKind(keywords: string, type: number, cookie: string | null): Promise<CatalogPage>;
  artistSongs(id: string, cookie: string | null): Promise<SearchHit[]>;
  albumTracks(id: string, cookie: string | null): Promise<SearchHit[]>;
  lyric(id: string, cookie: string | null): Promise<string>;
  likeSong(id: string, like: boolean, cookie: string): Promise<void>;
  collectSong(playlistId: string, trackId: string, cookie: string): Promise<void>;
}

export interface CatalogPage {
  hits: SearchHit[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
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
    async playlistTracks(id, cookie) {
      try {
        return await loadPlaylistPages(async (offset, limit) => (
          readPlaylistTracks(await module.playlist_track_all(withCookie({ id, limit, offset }, cookie)))
        ));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async similarSongs(id, cookie) {
      try {
        return readSimilar(await module.simi_song(withCookie({ id, limit: 20 }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async searchKind(keywords, type, cookie) {
      return readCatalog(await module.cloudsearch(withCookie({ keywords, type, limit: 20 }, cookie)), type);
    },
    async artistSongs(id, cookie) {
      try {
        return readSimilar(await module.artist_songs(withCookie({ id, limit: 50 }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async albumTracks(id, cookie) {
      try {
        return readAlbum(await module.album(withCookie({ id }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async lyric(id, cookie) {
      try {
        return readLyricText(await module.lyric(withCookie({ id }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async likeSong(id, like, cookie) {
      try {
        readMutation(await module.like(withCookie({ id, like }, cookie)), "like_failed");
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async collectSong(playlistId, trackId, cookie) {
      try {
        readMutation(await module.playlist_tracks(withCookie({
          op: "add",
          pid: playlistId,
          tracks: trackId,
        }, cookie)), "collect_failed");
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async dailySongs(cookie) {
      try {
        return readDailySongs(await module.recommend_songs(withCookie({}, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async radarId(cookie) {
      try {
        return readRadarId(await module.recommend_resource(withCookie({}, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
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
    const summary: PlaylistSummary = {
      id: String(item.id),
      name: item.name.trim().slice(0, 200),
      trackCount,
    };
    if (typeof item.specialType === "number" && Number.isInteger(item.specialType)) {
      summary.specialType = item.specialType;
    }
    playlists.push(summary);
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
const CATALOG_LIMIT = 100;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function readSearch(result: unknown): SearchHit[] {
  const body = bodyOf(result);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code !== 200) throw new Error("search_failed");
  return collectHits(asRecord(body?.result)?.songs, null, MAX_HITS);
}

export function readPlaylistTracks(result: unknown): SearchHit[] {
  const body = requireOk(result, "playlist_failed");
  return collectHits(body.songs, body.privileges, CATALOG_LIMIT);
}

export function readDailySongs(result: unknown): SearchHit[] {
  const body = requireOk(result, "daily_failed");
  const data = asRecord(body.data);
  return collectHits(data?.dailySongs, data?.privileges, CATALOG_LIMIT);
}

/** `simi_song` rows. Missing privilege is kept playable so explore is not emptied by a thin payload. */
export function readSimilar(result: unknown): SearchHit[] {
  const body = requireOk(result, "similar_failed");
  const songs = body.songs ?? asRecord(body.data)?.songs;
  return collectHits(songs, body.privileges, 30, true);
}

export function readAlbum(result: unknown): SearchHit[] {
  const body = requireOk(result, "album_failed");
  const album = asRecord(body.album);
  const songs = body.songs ?? album?.songs;
  return collectHits(songs, body.privileges, CATALOG_LIMIT, true);
}

export function readLyricText(result: unknown): string {
  const body = requireOk(result, "lyric_failed");
  const lrc = asRecord(body.lrc);
  return typeof lrc?.lyric === "string" ? lrc.lyric : "";
}

export function readCatalog(result: unknown, type: number): CatalogPage {
  const body = bodyOf(result);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code !== 200) throw new Error("search_failed");
  const record = asRecord(body?.result);
  if (type === 100) return { hits: [], artists: readArtistRows(record?.artists), albums: [] };
  if (type === 10) return { hits: [], artists: [], albums: readAlbumRows(record?.albums) };
  return { hits: collectHits(record?.songs, null, MAX_HITS), artists: [], albums: [] };
}

export function readMutation(result: unknown, failed: string): void {
  const body = bodyOf(result) ?? asRecord(asRecord(asRecord(result)?.body)?.body);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code != null && code !== 200) throw new Error(failed);
  if (code == null && asNumber(asRecord(result)?.status) !== 200) throw new Error(failed);
}

/** Playlist id for 私人雷达 inside the official daily-playlist list. */
export function readRadarId(result: unknown): string {
  const body = requireOk(result, "radar_failed");
  const list = body.recommend;
  if (!Array.isArray(list)) throw new Error("radar_missing");
  for (const item of list) {
    const row = asRecord(item);
    const name = typeof row?.name === "string" ? row.name : "";
    const id = row?.id == null ? "" : String(row.id);
    if (name.includes("私人雷达") && /^\d{1,20}$/.test(id)) return id;
  }
  throw new Error("radar_missing");
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

function requireOk(result: unknown, failed: string): Record<string, unknown> {
  const body = bodyOf(result);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code !== 200 || !body) throw new Error(failed);
  return body;
}

function bodyOf(result: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(result)?.body);
}

function collectHits(songs: unknown, privileges: unknown, limit: number, unknownPlayable = false): SearchHit[] {
  if (!Array.isArray(songs)) return [];
  const hits: SearchHit[] = [];
  for (let index = 0; index < songs.length; index += 1) {
    const song = asRecord(songs[index]);
    if (!song) continue;
    const hit = toHit(song, privilegeFor(song, privileges, index), unknownPlayable);
    if (!hit) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

function toHit(
  song: Record<string, unknown>,
  privilege: Record<string, unknown> | null,
  unknownPlayable = false,
): SearchHit | null {
  const id = song.id == null ? "" : String(song.id);
  const name = typeof song.name === "string" ? song.name.trim() : "";
  if (!/^\d{1,20}$/.test(id) || name.length === 0) return null;
  const duration = asNumber(song.dt);
  return {
    id,
    title: name.slice(0, 200),
    artist: readArtists(song.ar ?? song.artists ?? song.ar),
    durationMs: duration == null ? 0 : Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(duration))),
    playable: playableOf(song, privilege, unknownPlayable),
  };
}

function playableOf(
  song: Record<string, unknown>,
  privilege: Record<string, unknown> | null,
  unknownPlayable = false,
): boolean {
  const source = privilege ?? asRecord(song.privilege);
  if (source && (asNumber(source.st) != null || asNumber(source.pl) != null)) {
    const st = asNumber(source.st);
    const pl = asNumber(source.pl);
    return st != null && st >= 0 && pl != null && pl > 0;
  }
  const st = asNumber(song.st);
  if (st == null) return unknownPlayable;
  return st >= 0;
}

function readArtistRows(value: unknown): ArtistSummary[] {
  if (!Array.isArray(value)) return [];
  const rows: ArtistSummary[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const id = row?.id == null ? "" : String(row.id);
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!/^\d{1,20}$/.test(id) || name.length === 0) continue;
    rows.push({ id, name: name.slice(0, 200) });
    if (rows.length >= MAX_HITS) break;
  }
  return rows;
}

function readAlbumRows(value: unknown): AlbumSummary[] {
  if (!Array.isArray(value)) return [];
  const rows: AlbumSummary[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const id = row?.id == null ? "" : String(row.id);
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!/^\d{1,20}$/.test(id) || name.length === 0) continue;
    const artistRecord = asRecord(row?.artist);
    const artist = typeof artistRecord?.name === "string" && artistRecord.name.trim().length > 0
      ? artistRecord.name.trim().slice(0, 200)
      : readArtists(row?.artists);
    rows.push({ id, name: name.slice(0, 200), artist });
    if (rows.length >= MAX_HITS) break;
  }
  return rows;
}

function privilegeFor(
  song: Record<string, unknown>,
  privileges: unknown,
  index: number,
): Record<string, unknown> | null {
  const embedded = asRecord(song.privilege);
  if (embedded && (asNumber(embedded.st) != null || asNumber(embedded.pl) != null)) return embedded;
  if (!Array.isArray(privileges)) return null;
  const id = song.id == null ? "" : String(song.id);
  for (const item of privileges) {
    const row = asRecord(item);
    if (row && String(row.id) === id) return row;
  }
  return asRecord(privileges[index]);
}

function rethrowSignedOut(error: unknown): never {
  const record = asRecord(error);
  const body = asRecord(record?.body);
  if (asNumber(record?.status) === 301 || asNumber(body?.code) === 301) {
    throw new Error("signed_out");
  }
  throw error;
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
