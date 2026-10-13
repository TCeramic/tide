import { hasMusicU, normalizeCookie, type CookieStore } from "./cookie";
import type { NeteaseClient } from "./netease";
import type { ApiFailure, QrCheck, QrTicket, SessionSnapshot, SessionUser } from "../shared/contract";

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

  private async requireUser(cookie: string): Promise<SessionUser | null> {
    try {
      return await this.netease.loginStatus(cookie);
    } catch {
      throw new SessionError(502, "upstream", "登录状态暂时无法确认，请稍后再试");
    }
  }
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
