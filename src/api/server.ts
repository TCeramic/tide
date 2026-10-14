import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CookieStore } from "./cookie";
import { createNeteaseClient, type NeteaseClient } from "./netease";
import { parseLrc, parseYrc } from "../core/lyrics";
import { isLocalId } from "../core/local-library";
import { LocalLibrary } from "./local-library";
import { asFailure, SessionError, SessionService } from "./session";
import { API_READY_PREFIX, DEFAULT_API_PORT, TIDE_VERSION } from "../shared/contract";

export interface TideApiOptions {
  /** `undefined` reads TIDE_COOKIE_FILE. `null` keeps the cookie in memory. */
  cookieFile?: string | null;
  netease?: NeteaseClient;
}

/**
 * Loopback API for 潮汐 Tide.
 * NeteaseCloudMusicApi is called from these routes only. The process stays
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
    search: (keywords, cookie) => client().search(keywords, cookie),
    songUrl: (id, cookie, level) => client().songUrl(id, cookie, level),
    playlistTracks: (id, cookie) => client().playlistTracks(id, cookie),
    dailySongs: (cookie) => client().dailySongs(cookie),
    radarId: (cookie) => client().radarId(cookie),
    similarSongs: (id, cookie) => client().similarSongs(id, cookie),
    searchKind: (keywords, type, cookie) => client().searchKind(keywords, type, cookie),
    artistSongs: (id, cookie) => client().artistSongs(id, cookie),
    albumTracks: (id, cookie) => client().albumTracks(id, cookie),
    lyric: (id, cookie) => client().lyric(id, cookie),
    lyricNew: (id, cookie) => client().lyricNew(id, cookie),
    personalFm: (cookie) => client().personalFm(cookie),
    fmTrash: (id, cookie) => client().fmTrash(id, cookie),
    refreshLogin: (cookie) => client().refreshLogin(cookie),
    likeSong: (id, like, cookie) => client().likeSong(id, like, cookie),
    likedIds: (uid, cookie) => client().likedIds(uid, cookie),
    collectSong: (playlistId, trackId, cookie) => client().collectSong(playlistId, trackId, cookie),
  });

  function client(): NeteaseClient {
    if (!netease) netease = createNeteaseClient();
    return netease;
  }
  const library = new LocalLibrary(process.env.TIDE_LIBRARY_FILE ?? "");

  return http.createServer((req, res) => {
    void route(req, res, session, library).catch((error: unknown) => {
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

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  session: SessionService,
  library: LocalLibrary,
): Promise<void> {
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
  if (req.method === "GET" && pathname === "/local/tracks") {
    writeJson(res, 200, { ok: true, hits: library.list() });
    return;
  }
  if (req.method === "GET" && pathname === "/local/audio") {
    const track = library.find(url.searchParams.get("id") ?? "");
    if (!track) {
      writeJson(res, 404, { ok: false, error: "missing", message: "本地曲目不在库里" });
      return;
    }
    streamFile(req, res, track.file);
    return;
  }
  if (req.method === "GET" && pathname === "/search") {
    const type = Number(url.searchParams.get("type") ?? "1");
    const keywords = url.searchParams.get("keywords") ?? "";
    const local = type === 1 ? library.search(keywords) : [];
    try {
      const page = await session.searchCatalog(keywords, type);
      const hits = type === 1 ? [...local, ...page.hits] : page.hits;
      writeJson(res, 200, { ok: true, ...page, hits, cloud: true });
    } catch (error) {
      if (error instanceof SessionError && (error.error === "signed_out" || error.error === "upstream")) {
        writeJson(res, 200, {
          ok: true,
          kind: "songs",
          hits: local,
          artists: [],
          albums: [],
          cloud: false,
        });
        return;
      }
      throw error;
    }
    return;
  }
  if (req.method === "GET" && pathname === "/similar") {
    const hits = await session.similarSongs(url.searchParams.get("id") ?? "");
    writeJson(res, 200, { ok: true, hits, source: "simi_song" });
    return;
  }
  if (req.method === "GET" && pathname === "/artist/songs") {
    const hits = await session.artistSongs(url.searchParams.get("id") ?? "");
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [] });
    return;
  }
  if (req.method === "GET" && pathname === "/album/tracks") {
    const hits = await session.albumTracks(url.searchParams.get("id") ?? "");
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [] });
    return;
  }
  if (req.method === "GET" && pathname === "/lyric") {
    const trackId = url.searchParams.get("id") ?? "";
    const bundle = await session.lyric(trackId);
    const ytlrc = parseYrc(bundle.ytlrc);
    writeJson(res, 200, {
      ok: true,
      trackId,
      lines: parseLrc(bundle.lyric),
      translation: ytlrc.length > 0
        ? ytlrc.map((row) => ({ timeMs: row.timeMs, text: row.text }))
        : parseLrc(bundle.translation),
      romaji: parseLrc(bundle.romaji),
      yrc: parseYrc(bundle.yrc),
    });
    return;
  }
  if (req.method === "GET" && pathname === "/personal/fm") {
    const hits = await session.personalFm();
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [] });
    return;
  }
  if (req.method === "POST" && pathname === "/fm/trash") {
    const body = await readJson(req);
    const record = body && typeof body === "object" ? body as { id?: unknown } : {};
    const message = await session.fmTrash(typeof record.id === "string" ? record.id : "");
    writeJson(res, 200, { ok: true, message });
    return;
  }
  if (req.method === "POST" && pathname === "/song/like") {
    const body = await readJson(req);
    const record = body && typeof body === "object" ? body as { id?: unknown; like?: unknown } : {};
    const outcome = await session.likeSong(
      typeof record.id === "string" ? record.id : "",
      record.like !== false,
    );
    writeJson(res, 200, { ok: true, message: outcome.message, liked: outcome.liked });
    return;
  }
  if (req.method === "GET" && pathname === "/liked") {
    const liked = await session.likedSnapshot();
    writeJson(res, 200, { ok: true, ...liked });
    return;
  }
  if (req.method === "POST" && pathname === "/song/collect") {
    const body = await readJson(req);
    const record = body && typeof body === "object" ? body as { playlistId?: unknown; trackId?: unknown } : {};
    const message = await session.collectSong(
      typeof record.playlistId === "string" ? record.playlistId : "",
      typeof record.trackId === "string" ? record.trackId : "",
    );
    writeJson(res, 200, { ok: true, message });
    return;
  }
  if (req.method === "GET" && pathname === "/song/url") {
    const songId = url.searchParams.get("id") ?? "";
    if (isLocalId(songId)) {
      const track = library.find(songId);
      const port = req.socket.localPort;
      writeJson(res, track ? 200 : 404, track ? {
        ok: true,
        url: `http://127.0.0.1:${port}/local/audio?id=${encodeURIComponent(songId)}`,
        signedOut: false,
        level: "standard",
        requested: "standard",
      } : { ok: false, error: "missing", message: "本地曲目不在库里" });
      return;
    }
    const media = await session.mediaUrl(songId, url.searchParams.get("level"));
    writeJson(res, 200, {
      ok: true,
      url: media.url,
      signedOut: media.signedOut,
      level: media.level,
      requested: media.requested,
    });
    return;
  }
  if (req.method === "GET" && pathname === "/playlist/tracks") {
    const hits = await session.playlistTracks(url.searchParams.get("id") ?? "");
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [], loaded: hits.length });
    return;
  }
  if (req.method === "GET" && pathname === "/recommend/daily") {
    const hits = await session.dailySongs();
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [] });
    return;
  }
  if (req.method === "GET" && pathname === "/recommend/radar") {
    const hits = await session.radarSongs();
    writeJson(res, 200, { ok: true, kind: "songs", hits, artists: [], albums: [] });
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

function streamFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    writeJson(res, 404, { ok: false, error: "missing", message: "本地文件找不到了" });
    return;
  }
  const mime = filePath.toLowerCase().endsWith(".flac")
    ? "audio/flac"
    : filePath.toLowerCase().endsWith(".wav")
      ? "audio/wav"
      : filePath.toLowerCase().endsWith(".ogg")
        ? "audio/ogg"
        : filePath.toLowerCase().endsWith(".m4a") || filePath.toLowerCase().endsWith(".aac")
          ? "audio/mp4"
          : "audio/mpeg";
  const size = stat.size;
  const range = req.headers.range;
  if (range && /^bytes=\d+-\d*$/.test(range)) {
    const [startText, endText] = range.replace("bytes=", "").split("-");
    const start = Number(startText);
    const end = endText ? Number(endText) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
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
