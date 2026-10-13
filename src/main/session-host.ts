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

  return () => {
    ipcMain.removeHandler(Ipc.sessionGet);
    ipcMain.removeHandler(Ipc.sessionLogout);
    ipcMain.removeHandler(Ipc.sessionQrStart);
    ipcMain.removeHandler(Ipc.sessionCookie);
    ipcMain.removeHandler(Ipc.sessionQrCheck);
  };
}

function missingMusicU(): ApiFailure {
  return { ok: false, error: "missing_music_u", message: "Cookie 里需要有 MUSIC_U" };
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
