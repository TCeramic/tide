import { isAudioLevel, resolveSongLevel, type AudioLevel } from "../core/audio-level";
import { hasMusicU, normalizeCookie, type CookieStore } from "./cookie";
import { markLiked, type CatalogPage, type LyricBundle, type NeteaseClient, type SongMedia } from "./netease";
import type { ApiFailure, PlaylistSummary, QrCheck, QrTicket, SearchHit, SearchKind, SessionSnapshot, SessionUser } from "../shared/contract";

const QR_MESSAGE: Record<number, string> = {
  800: "二维码已过期，请刷新",
  801: "等待扫码",
  802: "已扫码，请在手机上确认",
  803: "登录成功",
};

const INVALID_LOGIN = "登录已失效，请重新登录";
const EXPIRED_LOGIN = "登录已过期，请重新扫码或粘贴 Cookie。";

export class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
  ) {
    super(message);
  }
}

export class SessionService {
  private likedCache: { at: number; ids: string[] } | null = null;

  constructor(
    private readonly store: CookieStore,
    private readonly netease: NeteaseClient,
    private readonly communityLyrics?: (id: string) => Promise<LyricBundle | null>,
  ) {}

  snapshot(): Promise<SessionSnapshot> {
    return this.sessionFromStore();
  }

  async saveCookie(input: string): Promise<SessionSnapshot> {
    const cookie = normalizeCookie(input);
    if (cookie == null || !hasMusicU(cookie)) {
      throw new SessionError(400, "missing_music_u", "Cookie 里需要有 MUSIC_U");
    }
    const user = await this.requireUser(cookie);
    if (!user) {
      return snapshot("invalid", INVALID_LOGIN, null, []);
    }
    this.store.write(cookie);
    return this.sessionFor(cookie, user);
  }

  logout(): SessionSnapshot {
    this.store.clear();
    return snapshot("signed_out", "已退出登录", null, []);
  }

  async startQr(): Promise<QrTicket> {
    try {
      const key = await this.netease.qrKey();
      const image = await this.netease.qrImage(key);
      return { ok: true, key, qrimg: image.qrimg, qrurl: image.qrurl };
    } catch {
      throw new SessionError(502, "upstream", "二维码暂时申请不到，请稍后再试");
    }
  }

  async checkQr(key: string): Promise<QrCheck> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw new SessionError(400, "bad_key", "二维码无效，请刷新");
    }
    let polled: { code: number; cookie: string | null };
    try {
      polled = await this.netease.qrCheck(key);
    } catch {
      throw new SessionError(502, "upstream", "二维码状态暂时查询不到");
    }
    const message = QR_MESSAGE[polled.code] ?? "登录状态未知";
    if (polled.code !== 803) {
      return { ok: true, code: polled.code, message, session: null };
    }
    const cookie = polled.cookie && hasMusicU(polled.cookie) ? normalizeCookie(polled.cookie) : null;
    if (cookie == null) {
      return {
        ok: true,
        code: polled.code,
        message: "扫码结果里没有 MUSIC_U，请重试",
        session: snapshot("invalid", "扫码结果里没有 MUSIC_U，请重试", null, []),
      };
    }
    const user = await this.requireUser(cookie);
    if (!user) {
      return {
        ok: true,
        code: polled.code,
        message: INVALID_LOGIN,
        session: snapshot("invalid", INVALID_LOGIN, null, []),
      };
    }
    this.store.write(cookie);
    const session = await this.sessionFor(cookie, user);
    return { ok: true, code: 803, message, session };
  }

  async search(keywords: string): Promise<SearchHit[]> {
    const page = await this.searchCatalog(keywords, 1);
    return page.hits;
  }

  async searchCatalog(keywords: string, type: number, offset=0): Promise<{
    offset:number; nextOffset:number; hasMore:boolean;
    kind: SearchKind;
    hits: SearchHit[];
    artists: CatalogPage["artists"];
    albums: CatalogPage["albums"];
  }> {
    const query = keywords.trim().slice(0, 80);
    if (query.length === 0) {
      throw new SessionError(400, "empty_query", "请输入要搜索的内容");
    }
    const kind = searchKindOf(type);
    const apiType = type === 1006 ? 1006 : searchTypeOf(kind);
    try {
      const page = await this.netease.searchKind(query, apiType, this.optionalCookie(), Math.max(0,Math.trunc(offset)));
      const count=kind==="artists"?page.artists.length:kind==="albums"?page.albums.length:page.hits.length;
      return {offset,nextOffset:offset+20,hasMore:count===20,kind, hits: await this.withLiked(page.hits), artists: page.artists, albums: page.albums };
    } catch (error) {
      if (error instanceof Error && error.message === "signed_out") {
        throw new SessionError(401, "signed_out", "请先登录");
      }
      throw new SessionError(502, "upstream", "搜索暂时不可用，请稍后再试");
    }
  }

  async similarSongs(id: string): Promise<SearchHit[]> {
    return this.catalog(id, "相似歌曲暂时没有拉到", (cookie) => this.netease.similarSongs(id, cookie));
  }

  async artistSongs(id: string): Promise<SearchHit[]> {
    return this.catalog(id, "这位歌手的歌暂时没有拉到", (cookie) => this.netease.artistSongs(id, cookie));
  }

  async albumTracks(id: string): Promise<SearchHit[]> {
    return this.catalog(id, "这张专辑暂时没有拉到", (cookie) => this.netease.albumTracks(id, cookie));
  }

  async lyric(id: string): Promise<LyricBundle> {
    const empty: LyricBundle = { lyric: "", translation: "", romaji: "", yrc: "", ytlrc: "" };
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "曲目编号无效");
    const pull = async (load: () => Promise<LyricBundle>): Promise<LyricBundle> => {
      try {
        return await load();
      } catch (error) {
        if (error instanceof Error && (error.message === "signed_out" || error.message === "lyric_failed")) return empty;
        return empty;
      }
    };
    const cookie = this.optionalCookie();
    const fresh = await pull(() => this.netease.lyricNew(id, cookie));
    const needsLegacy = fresh.yrc.length === 0 || fresh.lyric.length === 0 || fresh.translation.length === 0;
    const legacy = needsLegacy ? await pull(() => this.netease.lyric(id, cookie)) : empty;
    const community = !fresh.yrc && !legacy.yrc ? await this.communityLyrics?.(id).catch(() => null) : null;
    if (community) return { ...community, translation: community.translation || fresh.translation || legacy.translation, romaji: community.romaji || fresh.romaji || legacy.romaji };
    return {
      lyric: fresh.lyric || legacy.lyric,
      translation: fresh.translation || legacy.translation,
      romaji: fresh.romaji || legacy.romaji,
      yrc: fresh.yrc || legacy.yrc,
      ytlrc: fresh.ytlrc || legacy.ytlrc,
    };
  }

  async songArtwork(ids: string[]): Promise<Record<string, string>> {
    const valid = [...new Set(ids)].filter(id => /^\d{1,20}$/.test(id)).slice(0, 50);
    return this.netease.songArtwork?.(valid, this.optionalCookie()) ?? {};
  }

  async personalFm(): Promise<SearchHit[]> {
    const cookie = this.requireCookie();
    try {
      return await this.withLiked(await this.netease.personalFm(cookie));
    } catch (error) {
      throw catalogFailure(error, "私人 FM 暂时没有拉到");
    }
  }

  async fmTrash(id: string): Promise<string> {
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "曲目编号无效");
    const cookie = this.requireCookie();
    try {
      await this.netease.fmTrash(id, cookie);
      return "已标记不喜欢";
    } catch (error) {
      throw catalogFailure(error, "不喜欢没有成功，请确认已经登录");
    }
  }

  async likeSong(id: string, like: boolean): Promise<{ message: string; liked: boolean }> {
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "曲目编号无效");
    const cookie = this.requireCookie();
    try {
      await this.netease.likeSong(id, like, cookie);
      this.likedCache = null;
      return { message: like ? "已添加到喜欢" : "已取消喜欢", liked: like };
    } catch (error) {
      throw catalogFailure(error, "喜欢没有成功，请确认已经登录");
    }
  }

  async likedSnapshot(): Promise<{ known: boolean; ids: string[] }> {
    const ids = await this.knownLikedIds();
    if (!ids) return { known: false, ids: [] };
    return { known: true, ids };
  }

  async linkTidePlaylist(value:unknown):Promise<string>{
    const p=value&&typeof value==="object"?value as Record<string,unknown>:{};const cookie=this.requireCookie();if(typeof p.cloudId==="string"&&/^\d{1,20}$/.test(p.cloudId))return p.cloudId;
    if(typeof p.name!=="string"||!p.name.trim()||!this.netease.createCloudPlaylist)throw new SessionError(400,"bad_args","歌单名称无效");
    try{return await this.netease.createCloudPlaylist(p.name.slice(0,100),cookie);}catch(e){throw catalogFailure(e,"网易云歌单创建失败");}
  }
  async syncTidePlaylist(value:unknown):Promise<string>{
    const p=value&&typeof value==="object"?value as Record<string,unknown>:{};const cookie=this.requireCookie();
    if(typeof p.cloudId!=="string"||!/^\d{1,20}$/.test(p.cloudId)||typeof p.name!=="string"||!this.netease.syncCloudPlaylist)throw new SessionError(400,"bad_args","同步歌单信息无效");
    const songs=Array.isArray(p.songs)?p.songs:[],ids=[...new Set(songs.flatMap(v=>{const id=v&&typeof v==="object"?(v as {id?:unknown}).id:null;return typeof id==="string"&&/^\d{1,20}$/.test(id)?[id]:[];}))].slice(0,10000);
    const cover=typeof p.cover==="string"&&p.cover.length<1500000&&p.cover.startsWith("data:image/jpeg;base64,")?p.cover:undefined;
    try{await this.netease.syncCloudPlaylist({id:p.cloudId,name:p.name.slice(0,100),description:typeof p.description==="string"?p.description.slice(0,2000):"",cover,songIds:ids},cookie);return `已同步 ${ids.length} 首网易云歌曲${songs.length>ids.length?"；本地文件保留在 Tide 中":""}`;}catch(e){throw catalogFailure(e,"同步未完成，Tide歌单已保留，可重试");}
  }

  async collectSong(playlistId: string, trackId: string): Promise<string> {
    if (!/^\d{1,20}$/.test(playlistId) || !/^\d{1,20}$/.test(trackId)) {
      throw new SessionError(400, "bad_id", "歌单或曲目编号无效");
    }
    const cookie = this.requireCookie();
    try {
      await this.netease.collectSong(playlistId, trackId, cookie);
      return "已收藏到歌单";
    } catch (error) {
      throw catalogFailure(error, "收藏没有成功，请确认已经登录");
    }
  }

  private async catalog(
    id: string,
    unavailable: string,
    load: (cookie: string | null) => Promise<SearchHit[]>,
  ): Promise<SearchHit[]> {
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "编号无效");
    try {
      return await this.withLiked(await load(this.optionalCookie()));
    } catch (error) {
      throw catalogFailure(error, unavailable);
    }
  }

  async playlistTracks(id: string, offset = 0): Promise<SearchHit[]> {
    if (!/^\d{1,20}$/.test(id)) {
      throw new SessionError(400, "bad_id", "歌单编号无效");
    }
    const cookie = this.requireCookie();
    try {
      return await this.withLiked(await this.netease.playlistTracks(id, cookie, offset));
    } catch (error) {
      throw catalogFailure(error, "歌单暂时没有拉到");
    }
  }

  async dailySongs(): Promise<SearchHit[]> {
    const cookie = this.requireCookie();
    try {
      return await this.withLiked(await this.netease.dailySongs(cookie));
    } catch (error) {
      throw catalogFailure(error, "每日推荐暂时没有拉到");
    }
  }

  /** Login optional on purpose: `/personalized` still answers with generic picks. */
  async recommendedPlaylists(limit = 8): Promise<PlaylistSummary[]> {
    try {
      return await this.netease.recommendedPlaylists(this.optionalCookie(), limit);
    } catch (error) {
      throw catalogFailure(error, "推荐歌单暂时没有拉到");
    }
  }

  async radarSongs(): Promise<SearchHit[]> {
    const cookie = this.requireCookie();
    try {
      const id = await this.netease.radarId(cookie);
      return await this.withLiked(await this.netease.playlistTracks(id, cookie));
    } catch (error) {
      throw catalogFailure(error, "私人雷达暂时没有拉到");
    }
  }

  async mediaUrl(id: string, level: unknown): Promise<SongMedia & { level: AudioLevel; requested: AudioLevel }> {
    if (!/^\d{1,20}$/.test(id)) {
      throw new SessionError(400, "bad_id", "曲目编号无效");
    }
    const requested = isAudioLevel(level) ? level : "standard";
    try {
      return await resolveSongLevel(requested, (step) => this.netease.songUrl(id, this.optionalCookie(), step));
    } catch {
      throw new SessionError(502, "upstream", "播放地址暂时申请不到");
    }
  }

  private async sessionFromStore(): Promise<SessionSnapshot> {
    const cookie = this.store.read();
    if (cookie == null) return snapshot("signed_out", "未登录。本地曲目可以直接播放；云歌单和每日推荐需要登录。", null, []);
    if (!hasMusicU(cookie)) {
      return snapshot("invalid", "保存的 Cookie 里没有 MUSIC_U，请重新登录", null, []);
    }
    let active = cookie;
    try {
      const refreshed = await this.netease.refreshLogin(cookie);
      if (refreshed.expired) return snapshot("invalid", EXPIRED_LOGIN, null, []);
      if (refreshed.cookie && hasMusicU(refreshed.cookie)) {
        this.store.write(refreshed.cookie);
        active = refreshed.cookie;
      }
    } catch {
      // A failed refresh must not hide a later login-status failure.
    }
    const user = await this.requireUser(active);
    if (!user) return snapshot("invalid", INVALID_LOGIN, null, []);
    return this.sessionFor(active, user);
  }

  private async sessionFor(cookie: string, user: SessionUser): Promise<SessionSnapshot> {
    try {
      const playlists = await this.netease.playlists(cookie, user.id);
      const message = playlists.length === 0 ? "这个账号下还没有歌单。" : null;
      return snapshot("logged_in", message, user, playlists);
    } catch {
      return snapshot("logged_in", "歌单暂时没有拉到，请点刷新", user, []);
    }
  }

  private requireCookie(): string {
    const cookie = this.optionalCookie();
    if (cookie == null) throw new SessionError(401, "signed_out", "请先登录");
    return cookie;
  }

  private async knownLikedIds(): Promise<string[] | null> {
    const cookie = this.optionalCookie();
    if (!cookie) return null;
    if (this.likedCache && Date.now() - this.likedCache.at < 15_000) return this.likedCache.ids;
    try {
      const user = await this.netease.loginStatus(cookie);
      if (!user) return null;
      const ids = await this.netease.likedIds(user.id, cookie);
      this.likedCache = { at: Date.now(), ids };
      return ids;
    } catch {
      return this.likedCache?.ids ?? null;
    }
  }

  private async withLiked(hits: SearchHit[]): Promise<SearchHit[]> {
    const ids = await this.knownLikedIds();
    if (!ids) return hits;
    return markLiked(hits, ids);
  }

  private optionalCookie(): string | null {
    const cookie = this.store.read();
    if (cookie == null || !hasMusicU(cookie)) return null;
    return cookie;
  }

  private async requireUser(cookie: string): Promise<SessionUser | null> {
    try {
      return await this.netease.loginStatus(cookie);
    } catch {
      throw new SessionError(502, "upstream", "登录状态暂时无法确认，请稍后再试");
    }
  }
}

function searchKindOf(type: number): SearchKind {
  if (type === 100) return "artists";
  if (type === 10) return "albums";
  return "songs";
}

function searchTypeOf(kind: SearchKind): number {
  if (kind === "artists") return 100;
  if (kind === "albums") return 10;
  return 1;
}

function catalogFailure(error: unknown, unavailable: string): SessionError {
  if (error instanceof SessionError) return error;
  if (error instanceof Error && error.message === "signed_out") {
    return new SessionError(401, "signed_out", "请先登录");
  }
  if (error instanceof Error && error.message === "radar_missing") {
    return new SessionError(404, "radar_missing", "这个账号暂时没有私人雷达");
  }
  if (error instanceof Error && error.message === "already_in_playlist") {
    return new SessionError(409, "already_in_playlist", "已在歌单中");
  }
  return new SessionError(502, "upstream", unavailable);
}

export function asFailure(error: SessionError): ApiFailure {
  return { ok: false, error: error.error, message: error.message };
}

function snapshot(
  state: SessionSnapshot["state"],
  message: string | null,
  user: SessionUser | null,
  playlists: SessionSnapshot["playlists"],
): SessionSnapshot {
  return { ok: true, state, message, user, playlists };
}
