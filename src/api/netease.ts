import path from "node:path";
import { createRequire } from "node:module";
import type { AudioLevel } from "../core/audio-level";

import { normalizeArtworkUrl } from "../core/artwork";
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
    profile?: { userId?: number; nickname?: string; avatarUrl?: string };
  };
  playlist?: NcmPlaylist[];
}

interface NcmPlaylist {
  coverImgUrl?: string;
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
  playlist_create(query:{name:string;privacy:string;cookie:string}):Promise<unknown>;
  playlist_name_update(query:{id:string;name:string;cookie:string}):Promise<unknown>;
  playlist_desc_update(query:{id:string;desc:string;cookie:string}):Promise<unknown>;
  playlist_cover_update(query:{id:string;imgFile:{name:string;data:Buffer};cookie:string}):Promise<unknown>;
  login_qr_key(query: { cookie?: string }): Promise<NcmResult>;
  login_qr_create(query: { key: string; qrimg?: boolean; cookie?: string }): Promise<NcmResult>;
  login_qr_check(query: { key: string; cookie?: string }): Promise<NcmResult>;
  login_status(query: { cookie?: string }): Promise<NcmResult>;
  user_playlist(query: { uid: string; limit?: number; cookie?: string }): Promise<NcmResult>;
  cloudsearch(query: { keywords: string; type?: number; limit?: number; offset?: number; cookie?: string }): Promise<unknown>;
  song_url(query: { id: string; br?: number; cookie?: string }): Promise<unknown>;
  song_url_v1(query: { id: string; level: string; cookie?: string }): Promise<unknown>;
  personal_fm(query: { cookie?: string }): Promise<unknown>;
  fm_trash(query: { id: string; cookie?: string }): Promise<unknown>;
  login_refresh(query: { cookie?: string }): Promise<NcmResult>;
  playlist_track_all(query: { id: string; limit?: number; offset?: number; cookie?: string }): Promise<unknown>;
  recommend_songs(query: { cookie?: string }): Promise<unknown>;
  recommend_resource(query: { cookie?: string }): Promise<unknown>;
  simi_song(query: { id: string; limit?: number; cookie?: string }): Promise<unknown>;
  lyric(query: { id: string; cookie?: string }): Promise<unknown>;
  lyric_new?(query: { id: string; cookie?: string }): Promise<unknown>;
  like(query: { id: string; like: "true" | "false"; cookie?: string }): Promise<unknown>;
  likelist(query: { uid: string; cookie?: string }): Promise<unknown>;
  playlist_tracks(query: { op: "add" | "del"; pid: string; tracks: string; cookie?: string }): Promise<unknown>;
  artist_songs(query: { id: string; limit?: number; cookie?: string }): Promise<unknown>;
  album(query: { id: string; cookie?: string }): Promise<unknown>;
  song_detail?(query: { ids: string; cookie?: string }): Promise<unknown>;
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

export interface LyricBundle {
  source?: "netease" | "amll";
  credits?: string[];
  lyric: string;
  translation: string;
  romaji: string;
  yrc: string;
  ytlrc: string;
}

export interface LoginRefresh {
  cookie: string | null;
  expired: boolean;
}

/** Calls into the pinned NeteaseCloudMusicApi package. No HTTP surface of its own. */
export interface NeteaseClient {
  createCloudPlaylist?(name:string,cookie:string):Promise<string>;
  syncCloudPlaylist?(input:{id:string;name:string;description:string;cover?:string;songIds:string[]},cookie:string):Promise<void>;
  songArtwork?(ids: string[], cookie: string | null): Promise<Record<string, string>>;
  qrKey(): Promise<string>;
  qrImage(key: string): Promise<QrImage>;
  qrCheck(key: string): Promise<QrPoll>;
  loginStatus(cookie: string): Promise<SessionUser | null>;
  playlists(cookie: string, uid: string): Promise<PlaylistSummary[]>;
  search(keywords: string, cookie: string | null): Promise<SearchHit[]>;
  songUrl(id: string, cookie: string | null, level: AudioLevel): Promise<SongMedia>;
  playlistTracks(id: string, cookie: string, offset?: number): Promise<SearchHit[]>;
  dailySongs(cookie: string): Promise<SearchHit[]>;
  radarId(cookie: string): Promise<string>;
  /** Similar songs via `simi_song`. Not daily recommend and not 私人雷达. */
  similarSongs(id: string, cookie: string | null): Promise<SearchHit[]>;
  searchKind(keywords: string, type: number, cookie: string | null, offset?: number): Promise<CatalogPage>;
  artistSongs(id: string, cookie: string | null): Promise<SearchHit[]>;
  albumTracks(id: string, cookie: string | null): Promise<SearchHit[]>;
  lyric(id: string, cookie: string | null): Promise<LyricBundle>;
  lyricNew(id: string, cookie: string | null): Promise<LyricBundle>;
  personalFm(cookie: string): Promise<SearchHit[]>;
  fmTrash(id: string, cookie: string): Promise<void>;
  refreshLogin(cookie: string): Promise<LoginRefresh>;
  likeSong(id: string, like: boolean, cookie: string): Promise<void>;
  /** Liked song ids from `likelist` (`/api/song/like/get`). */
  likedIds(uid: string, cookie: string): Promise<string[]>;
  collectSong(playlistId: string, trackId: string, cookie: string): Promise<void>;
}

export interface CatalogPage {
  hits: SearchHit[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
}

export function createNeteaseClient(module: NcmModule = loadNeteaseModule()): NeteaseClient {
  const covers = new Map<string, string>();
  const hydrateCovers = async (hits: SearchHit[], cookie: string | null): Promise<SearchHit[]> => {
    for (const hit of hits) if (hit.cover) covers.set(hit.id, hit.cover);
    const missing = [...new Set(hits.filter(hit => !hit.cover && !covers.has(hit.id)).map(hit => hit.id))];
    if (module.song_detail && missing.length > 0) {
      // Batch the documented song/detail endpoint; a missing image must never
      // turn a usable search/playlist into an error or alter play privileges.
      for (let offset = 0; offset < missing.length; offset += 500) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            module.song_detail(withCookie({ ids: missing.slice(offset, offset + 500).join(",") }, cookie)),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("cover_timeout")), 5000); }),
          ]);
          const body = requireOk(result, "cover_failed");
          for (const detail of collectHits(body.songs, null, 500, true)) if (detail.cover) covers.set(detail.id, detail.cover);
        } catch { break; }
        finally { if (timeout) clearTimeout(timeout); }
      }
    }
    const enriched = hits.map(hit => !hit.cover && covers.has(hit.id) ? { ...hit, cover: covers.get(hit.id)! } : hit);
    while (covers.size > 2000) covers.delete(covers.keys().next().value!);
    return enriched;
  };
  return {
    async songArtwork(ids, cookie) {
      const hits = await hydrateCovers(ids.map(id => ({ id, title: "", artist: "", durationMs: 0, playable: false })), cookie);
      return Object.fromEntries(hits.filter(hit => hit.cover).map(hit => [hit.id, hit.cover!]));
    },
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
      return hydrateCovers(readSearch(await module.cloudsearch(withCookie({ keywords, type: 1, limit: 20 }, cookie))), cookie);
    },
    async songUrl(id, cookie, level) {
      return readSongUrl(await module.song_url_v1(withCookie({ id, level }, cookie)));
    },
    async playlistTracks(id, cookie, offset = 0) {
      try {
        const hits = readPlaylistTracks(await module.playlist_track_all(withCookie({ id, limit: 100, offset }, cookie))).slice(0, 100);
        return hydrateCovers(hits, cookie);
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async similarSongs(id, cookie) {
      try {
        return hydrateCovers(readSimilar(await module.simi_song(withCookie({ id, limit: 20 }, cookie))), cookie);
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async createCloudPlaylist(name,cookie){
      const result=await module.playlist_create({name,privacy:"10",cookie});readMutation(result,"create_playlist_failed");const body=bodyOf(result),playlist=asRecord(body?.playlist),id=String(playlist?.id??body?.id??"");if(!/^\d{1,20}$/.test(id))throw new Error("create_playlist_failed");return id;
    },
    async syncCloudPlaylist(input,cookie){
      readMutation(await module.playlist_name_update({id:input.id,name:input.name,cookie}),"playlist_name_failed");readMutation(await module.playlist_desc_update({id:input.id,desc:input.description,cookie}),"playlist_desc_failed");
      const existing:string[]=[];
      for(let offset=0;offset<10000;offset+=100){const page=readPlaylistTracks(await module.playlist_track_all({id:input.id,limit:100,offset,cookie}));existing.push(...page.map(h=>h.id));if(page.length<100)break;}
      const desired=new Set(input.songIds),known=new Set(existing);
      for(const [op,ids]of [["del",existing.filter(id=>!desired.has(id))],["add",input.songIds.filter(id=>!known.has(id))]] as const){for(let i=0;i<ids.length;i+=500)readCollect(await module.playlist_tracks({op,pid:input.id,tracks:ids.slice(i,i+500).join(","),cookie}));}
      if(input.cover?.startsWith("data:image/jpeg;base64,")){const result=await module.playlist_cover_update({id:input.id,cookie,imgFile:{name:"tide-cover.jpg",data:Buffer.from(input.cover.split(",")[1],"base64")}});readMutation(result,"playlist_cover_failed");const detail=asRecord(bodyOf(result)?.data);if(detail?.code&&detail.code!==200)throw new Error("playlist_cover_failed");}
    },
    async searchKind(keywords, type, cookie, offset=0) {
      const page = readCatalog(await module.cloudsearch(withCookie({ keywords, type, limit: 20, offset }, cookie)), type);
      return { ...page, hits: await hydrateCovers(page.hits, cookie) };
    },
    async artistSongs(id, cookie) {
      try {
        return hydrateCovers(readSimilar(await module.artist_songs(withCookie({ id, limit: 50 }, cookie))), cookie);
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async albumTracks(id, cookie) {
      try {
        return hydrateCovers(readAlbum(await module.album(withCookie({ id }, cookie))), cookie);
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async lyric(id, cookie) {
      try {
        return readLyricBundle(await module.lyric(withCookie({ id }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async lyricNew(id, cookie) {
      if (!module.lyric_new) return emptyLyric();
      try {
        return readLyricBundle(await module.lyric_new(withCookie({ id }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async personalFm(cookie) {
      try {
        return hydrateCovers(readPersonalFm(await module.personal_fm(withCookie({}, cookie))), cookie);
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async fmTrash(id, cookie) {
      try {
        readMutation(await module.fm_trash(withCookie({ id }, cookie)), "fm_trash_failed");
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async refreshLogin(cookie) {
      return readLoginRefresh(await module.login_refresh(withCookie({}, cookie)));
    },
    async likeSong(id, like, cookie) {
      try {
        // NeteaseCloudMusicApi 4.32.0 treats anything other than the string "false" as a like.
        const flag = like ? "true" : "false";
        readMutation(await module.like(withCookie({ id, like: flag }, cookie)), "like_failed");
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async likedIds(uid, cookie) {
      try {
        return readLikeIds(await module.likelist(withCookie({ uid }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async collectSong(playlistId, trackId, cookie) {
      try {
        readCollect(await module.playlist_tracks(withCookie({
          op: "add",
          pid: playlistId,
          tracks: trackId,
        }, cookie)));
      } catch (error) {
        rethrowSignedOut(error);
      }
    },
    async dailySongs(cookie) {
      try {
        return hydrateCovers(readDailySongs(await module.recommend_songs(withCookie({}, cookie))), cookie);
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
  const user = { id: String(id), nickname: nickname && nickname.length > 0 ? nickname : "网易云用户" };
  const avatar = data.profile?.avatarUrl;
  if (typeof avatar === "string" && isHttpUrl(avatar)) return { ...user, avatar };
  return user;
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
    const cover=readCoverUrl({coverImgUrl:item.coverImgUrl});if(cover)summary.cover=cover;
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
  const cover = album ? readCoverUrl(album) : null;
  return collectHits(songs, body.privileges, CATALOG_LIMIT, true).map(hit => !hit.cover && cover ? { ...hit, cover } : hit);
}

export function readLyricText(result: unknown): string {
  return readLyricBundle(result).lyric;
}

export function readLyricBundle(result: unknown): LyricBundle {
  const body = requireOk(result, "lyric_failed");
  const text = (key: string) => {
    const row = asRecord(body[key]);
    return typeof row?.lyric === "string" ? row.lyric : "";
  };
  return {
    lyric: text("lrc"),
    translation: text("tlyric"),
    romaji: text("romalrc"),
    yrc: text("yrc"),
    ytlrc: text("ytlrc"),
  };
}

function emptyLyric(): LyricBundle {
  return { lyric: "", translation: "", romaji: "", yrc: "", ytlrc: "" };
}

/** `personal_fm` songs. Privilege is often missing, so a row stays playable. */
export function readPersonalFm(result: unknown): SearchHit[] {
  const body = requireOk(result, "fm_failed");
  const data = body.data;
  const songs = Array.isArray(data) ? data : asRecord(data)?.data;
  return collectHits(songs, null, 10, true);
}

export function readLoginRefresh(result: unknown): LoginRefresh {
  const record = asRecord(result);
  const body = asRecord(record?.body);
  const code = asNumber(body?.code);
  if (code === 301 || code === 400 || asNumber(record?.status) === 301) {
    return { cookie: null, expired: true };
  }
  if (code != null && code !== 200) return { cookie: null, expired: true };
  const fromBody = typeof body?.cookie === "string" ? body.cookie : "";
  const fromList = Array.isArray(record?.cookie) ? (record.cookie as unknown[]).filter((item) => typeof item === "string").join(";") : "";
  const cookie = (fromBody || fromList).trim();
  return { cookie: cookie.length > 0 ? cookie : null, expired: false };
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

/** `likelist` body is `{ code: 200, ids: number[] }`. Signed-out and other failures throw. */
export function readLikeIds(result: unknown): string[] {
  const body = bodyOf(result);
  const code = asNumber(body?.code);
  if (code === 301) throw new Error("signed_out");
  if (code !== 200 || !body) throw new Error("likelist_failed");
  const ids = body.ids;
  if (!Array.isArray(ids)) return [];
  const parsed: string[] = [];
  for (const id of ids) {
    const text = typeof id === "number" || typeof id === "string" ? String(id) : "";
    if (/^\d{1,20}$/.test(text)) parsed.push(text);
  }
  return parsed;
}

/** Mark each row from the liked-id list. Ids absent from the list are explicitly not liked. */
export function markLiked<T extends { id: string }>(hits: readonly T[], ids: readonly string[]): Array<T & { liked: boolean }> {
  const liked = new Set(ids);
  return hits.map((hit) => ({ ...hit, liked: liked.has(hit.id) }));
}

export function readMutation(result: unknown, failed: string): void {
  const code = mutationCode(result);
  if (code === 301) throw new Error("signed_out");
  if (code != null && code !== 200) throw new Error(failed);
  if (code == null && asNumber(asRecord(result)?.status) !== 200) throw new Error(failed);
}

/**
 * `playlist_tracks` spreads the request answer into `body`, so a duplicate is
 * `{ status:200, body:{ status:200, body:{ code:502, message:"歌单内歌曲重复" } } }`.
 */
export function readCollect(result: unknown): void {
  if (mutationCode(result) === 502) throw new Error("already_in_playlist");
  readMutation(result, "collect_failed");
}

/** Prefer `body.body.code` from the playlist_tracks wrapper, then the outer code. */
function mutationCode(result: unknown): number | null {
  const body = asRecord(asRecord(result)?.body);
  const nested = asNumber(asRecord(body?.body)?.code);
  if (nested != null) return nested;
  return asNumber(body?.code);
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
  const duration = asNumber(song.dt) ?? asNumber(song.duration);
  const hit: SearchHit = {
    id,
    title: name.slice(0, 200),
    artist: readArtists(song.ar ?? song.artists ?? song.ar),
    durationMs: duration == null ? 0 : Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(duration))),
    playable: playableOf(song, privilege, unknownPlayable),
  };
  if (song.liked === true) hit.liked = true;
  const album = asRecord(song.al ?? song.album);
  if (typeof album?.name === "string") hit.albumTitle = album.name.slice(0, 200);
  if (album?.id != null && /^\d{1,20}$/.test(String(album.id))) hit.albumId = String(album.id);
  const cover = readCoverUrl(song);
  if (cover) hit.cover = cover;
  return hit;
}

/** Album art from a song payload. Only http(s) URLs are kept. */
export function readCoverUrl(song: Record<string, unknown>): string | null {
  const al = asRecord(song.al), album = asRecord(song.album);
  for (const raw of [al?.picUrl, album?.picUrl, song.picUrl, song.coverImgUrl, song.img1v1Url]) {
    const url = normalizeArtworkUrl(raw);
    if (url) return url;
  }
  return null;
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
    const cover = row ? readCoverUrl(row) : null;
    rows.push({ id, name: name.slice(0, 200), ...(cover ? { cover } : {}) });
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
    const cover = row ? readCoverUrl(row) : null;
    rows.push({ id, name: name.slice(0, 200), artist, ...(cover ? { cover } : {}) });
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
