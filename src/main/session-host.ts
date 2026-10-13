import http from "node:http";
import { ipcMain } from "electron";
import { hasMusicU, normalizeCookie } from "../api/cookie";
import { Ipc, type ApiFailure } from "../shared/contract";

const UPSTREAM_TIMEOUT_MS = 20_000;

export function attachSession(getPort: () => number | null): () => void {
  ipcMain.handle(Ipc.sessionGet, () => proxy(getPort(), "GET", "/session"));
  ipcMain.handle(Ipc.sessionLogout, () => proxy(getPort(), "POST", "/session/logout"));
  ipcMain.handle(Ipc.sessionQrStart, () => proxy(getPort(), "POST", "/session/qr/start"));
  ipcMain.handle(Ipc.sessionCookie, (_event, cookie: unknown) => {
    if (typeof cookie !== "string") return missingMusicU();
    const normalized = normalizeCookie(cookie);
    if (normalized == null || !hasMusicU(normalized)) return missingMusicU();
    return proxy(getPort(), "POST", "/session/cookie", { cookie: normalized });
  });
  ipcMain.handle(Ipc.sessionQrCheck, (_event, key: unknown) => {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      return { ok: false, error: "bad_key", message: "二维码无效，请刷新" } satisfies ApiFailure;
    }
    return proxy(getPort(), "GET", `/session/qr/check?key=${encodeURIComponent(key)}`);
  });
  ipcMain.handle(Ipc.playlistTracks, (_event, id: unknown) => {
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) {
      return { ok: false, error: "bad_id", message: "歌单编号无效" } satisfies ApiFailure;
    }
    return loopbackJson(getPort(), "GET", `/playlist/tracks?id=${encodeURIComponent(id)}`);
  });
  ipcMain.handle(Ipc.daily, () => loopbackJson(getPort(), "GET", "/recommend/daily"));
  ipcMain.handle(Ipc.radar, () => loopbackJson(getPort(), "GET", "/recommend/radar"));
  ipcMain.handle(Ipc.search, (_event, keywords: unknown, type: unknown) => {
    if (typeof keywords !== "string") return emptyQuery();
    const query = keywords.trim().slice(0, 80);
    if (query.length === 0) return emptyQuery();
    const kind = type === 100 || type === 10 || type === 1006 || type === 1 ? type : 1;
    return loopbackJson(getPort(), "GET", `/search?keywords=${encodeURIComponent(query)}&type=${kind}`);
  });
  ipcMain.handle(Ipc.artistSongs, (_event, id: unknown) => trackList(getPort(), "/artist/songs", id));
  ipcMain.handle(Ipc.albumTracks, (_event, id: unknown) => trackList(getPort(), "/album/tracks", id));
  ipcMain.handle(Ipc.lyric, (_event, id: unknown) => trackList(getPort(), "/lyric", id));
  ipcMain.handle(Ipc.likeSong, (_event, id: unknown, like: unknown) => {
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) {
      return { ok: false, error: "bad_id", message: "曲目编号无效" } satisfies ApiFailure;
    }
    return loopbackJson(getPort(), "POST", "/song/like", { id, like: like !== false });
  });
  ipcMain.handle(Ipc.collectSong, (_event, playlistId: unknown, trackId: unknown) => {
    if (typeof playlistId !== "string" || typeof trackId !== "string") {
      return { ok: false, error: "bad_id", message: "歌单或曲目编号无效" } satisfies ApiFailure;
    }
    return loopbackJson(getPort(), "POST", "/song/collect", { playlistId, trackId });
  });

  return () => {
    ipcMain.removeHandler(Ipc.sessionGet);
    ipcMain.removeHandler(Ipc.sessionLogout);
    ipcMain.removeHandler(Ipc.sessionQrStart);
    ipcMain.removeHandler(Ipc.sessionCookie);
    ipcMain.removeHandler(Ipc.sessionQrCheck);
    ipcMain.removeHandler(Ipc.search);
    ipcMain.removeHandler(Ipc.artistSongs);
    ipcMain.removeHandler(Ipc.albumTracks);
    ipcMain.removeHandler(Ipc.lyric);
    ipcMain.removeHandler(Ipc.likeSong);
    ipcMain.removeHandler(Ipc.collectSong);
    ipcMain.removeHandler(Ipc.playlistTracks);
    ipcMain.removeHandler(Ipc.daily);
    ipcMain.removeHandler(Ipc.radar);
  };
}

export function loopbackJson(port: number | null, method: string, pathname: string, body?: unknown): Promise<unknown> {
  return proxy(port, method, pathname, body);
}

function missingMusicU(): ApiFailure {
  return { ok: false, error: "missing_music_u", message: "Cookie 里需要有 MUSIC_U" };
}

function trackList(port: number | null, pathname: string, id: unknown): Promise<unknown> {
  if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) {
    return Promise.resolve({ ok: false, error: "bad_id", message: "编号无效" } satisfies ApiFailure);
  }
  return loopbackJson(port, "GET", `${pathname}?id=${encodeURIComponent(id)}`);
}

function emptyQuery(): ApiFailure {
  return { ok: false, error: "empty_query", message: "请输入要搜索的歌名" };
}

function proxy(port: number | null, method: string, pathname: string, body?: unknown): Promise<unknown> {
  if (port == null) {
    return Promise.resolve({ ok: false, error: "stopped", message: "本地 API 未就绪" } satisfies ApiFailure);
  }
  return requestJson(port, method, pathname, body);
}

function requestJson(port: number, method: string, pathname: string, body?: unknown): Promise<unknown> {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        timeout: UPSTREAM_TIMEOUT_MS,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": payload.length }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          } catch {
            resolve({ ok: false, error: "bad_json", message: "本地 API 响应异常" } satisfies ApiFailure);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout", message: "网易云接口超时，请稍后再试" } satisfies ApiFailure);
    });
    req.on("error", () => {
      resolve({ ok: false, error: "unreachable", message: "本地 API 未就绪" } satisfies ApiFailure);
    });
    req.end(payload ?? undefined);
  });
}
