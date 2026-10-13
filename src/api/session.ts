import { hasMusicU, normalizeCookie, type CookieStore } from "./cookie";
import type { NeteaseClient, SongMedia } from "./netease";
import type { ApiFailure, QrCheck, QrTicket, SearchHit, SearchKind, SessionSnapshot, SessionUser } from "../shared/contract";
import type { CatalogPage } from "./netease";

const QR_MESSAGE: Record<number, string> = {
  800: "二维码已过期，请刷新",
  801: "等待扫码",
  802: "已扫码，请在手机上确认",
  803: "登录成功",
};

const INVALID_LOGIN = "登录已失效，请重新登录";

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
  constructor(
    private readonly store: CookieStore,
    private readonly netease: NeteaseClient,
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

  async searchCatalog(keywords: string, type: number): Promise<{
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
      const page = await this.netease.searchKind(query, apiType, this.optionalCookie());
      return { kind, hits: page.hits, artists: page.artists, albums: page.albums };
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

  async lyric(id: string): Promise<string> {
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "曲目编号无效");
    try {
      return await this.netease.lyric(id, this.optionalCookie());
    } catch (error) {
      if (error instanceof Error && error.message === "signed_out") return "";
      if (error instanceof Error && error.message === "lyric_failed") return "";
      throw new SessionError(502, "upstream", "歌词暂时没有拉到");
    }
  }

  async likeSong(id: string, like: boolean): Promise<string> {
    if (!/^\d{1,20}$/.test(id)) throw new SessionError(400, "bad_id", "曲目编号无效");
    const cookie = this.requireCookie();
    try {
      await this.netease.likeSong(id, like, cookie);
      return like ? "已添加到喜欢" : "已取消喜欢";
    } catch (error) {
      throw catalogFailure(error, "喜欢没有成功，请确认已经登录");
    }
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
      return await load(this.optionalCookie());
    } catch (error) {
      throw catalogFailure(error, unavailable);
    }
  }

  async playlistTracks(id: string): Promise<SearchHit[]> {
    if (!/^\d{1,20}$/.test(id)) {
      throw new SessionError(400, "bad_id", "歌单编号无效");
    }
    const cookie = this.requireCookie();
    try {
      return await this.netease.playlistTracks(id, cookie);
    } catch (error) {
      throw catalogFailure(error, "歌单暂时没有拉到");
    }
  }

  async dailySongs(): Promise<SearchHit[]> {
    const cookie = this.requireCookie();
    try {
      return await this.netease.dailySongs(cookie);
    } catch (error) {
      throw catalogFailure(error, "每日推荐暂时没有拉到");
    }
  }

  async radarSongs(): Promise<SearchHit[]> {
    const cookie = this.requireCookie();
    try {
      const id = await this.netease.radarId(cookie);
      return await this.netease.playlistTracks(id, cookie);
    } catch (error) {
      throw catalogFailure(error, "私人雷达暂时没有拉到");
    }
  }

  async mediaUrl(id: string): Promise<SongMedia> {
    if (!/^\d{1,20}$/.test(id)) {
      throw new SessionError(400, "bad_id", "曲目编号无效");
    }
    try {
      return await this.netease.songUrl(id, this.optionalCookie());
    } catch {
      throw new SessionError(502, "upstream", "播放地址暂时申请不到");
    }
  }

  private async sessionFromStore(): Promise<SessionSnapshot> {
    const cookie = this.store.read();
    if (cookie == null) return snapshot("signed_out", "登录后可以查看你的歌单。", null, []);
    if (!hasMusicU(cookie)) {
      return snapshot("invalid", "保存的 Cookie 里没有 MUSIC_U，请重新登录", null, []);
    }
    const user = await this.requireUser(cookie);
    if (!user) return snapshot("invalid", INVALID_LOGIN, null, []);
    return this.sessionFor(cookie, user);
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
