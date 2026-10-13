import http from "node:http";
import path from "node:path";
import { CookieStore } from "./cookie";
import { createNeteaseClient, type NeteaseClient } from "./netease";
import { asFailure, SessionError, SessionService } from "./session";
import { API_READY_PREFIX, DEFAULT_API_PORT, TIDE_VERSION } from "../shared/contract";

export interface TideApiOptions {
  /** `undefined` reads TIDE_COOKIE_FILE. `null` keeps the cookie in memory. */
  cookieFile?: string | null;
  netease?: NeteaseClient;
}

/**
 * Loopback API for 潮汐 Tide.
 * NeteaseCloudMusicApi is called from the session routes. The process stays
 * on 127.0.0.1 and does not publish that package's full route list.
 */
export function createTideApiServer(options: TideApiOptions = {}): http.Server {
  const cookieFile = options.cookieFile === undefined ? (process.env.TIDE_COOKIE_FILE ?? null) : options.cookieFile;
  let netease = options.netease ?? null;
  const session = new SessionService(new CookieStore(cookieFile), {
    qrKey: () => client().qrKey(),
    qrImage: (key) => client().qrImage(key),
    qrCheck: (key) => client().qrCheck(key),
    loginStatus: (cookie) => client().loginStatus(cookie),
    playlists: (cookie, uid) => client().playlists(cookie, uid),
  });

  function client(): NeteaseClient {
    if (!netease) netease = createNeteaseClient();
    return netease;
  }

  return http.createServer((req, res) => {
    void route(req, res, session).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof SessionError) {
        writeJson(res, error.status, asFailure(error));
        return;
      }
      if (error instanceof Error && (error.message === "bad_json" || error.message === "body_too_large")) {
        writeJson(res, 400, { ok: false, error: error.message, message: "请求格式不正确" });
        return;
      }
      writeJson(res, 502, { ok: false, error: "upstream", message: "网易云接口暂不可用，请稍后再试" });
    });
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, session: SessionService): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    writeJson(res, 200, { ok: true, service: "tide", version: TIDE_VERSION });
    return;
  }
  if (req.method === "GET" && pathname === "/session") {
    writeJson(res, 200, await session.snapshot());
    return;
  }
  if (req.method === "POST" && pathname === "/session/logout") {
    writeJson(res, 200, session.logout());
    return;
  }
  if (req.method === "POST" && pathname === "/session/cookie") {
    const body = await readJson(req);
    const cookie = body && typeof body === "object" ? (body as { cookie?: unknown }).cookie : undefined;
    if (typeof cookie !== "string") {
      writeJson(res, 400, { ok: false, error: "missing_music_u", message: "Cookie 里需要有 MUSIC_U" });
      return;
    }
    writeJson(res, 200, await session.saveCookie(cookie));
    return;
  }
  if (req.method === "POST" && pathname === "/session/qr/start") {
    writeJson(res, 200, await session.startQr());
    return;
  }
  if (req.method === "GET" && pathname === "/session/qr/check") {
    writeJson(res, 200, await session.checkQr(url.searchParams.get("key") ?? ""));
    return;
  }
  if (pathname === "/session" || pathname.startsWith("/session/")) {
    writeJson(res, 405, { ok: false, error: "method", message: "请求方法不对" });
    return;
  }
  writeJson(res, 404, { ok: false, error: "not_found", message: "没有这个接口" });
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32_768) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", () => reject(new Error("bad_json")));
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function listenFromEnv(): void {
  const port = Number(process.env.TIDE_API_PORT ?? DEFAULT_API_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write("tide-api invalid port\n");
    process.exit(1);
  }

  const server = createTideApiServer();
  server.on("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(`tide-api ${error.message}\n`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const bound = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`${API_READY_PREFIX}${bound}\n`);
  });
}

const entry = process.argv[1] ? path.basename(process.argv[1]) : "";
if (entry === "server.js" || entry === "server.ts") {
  listenFromEnv();
}
