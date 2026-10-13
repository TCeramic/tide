import crypto from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { dispatchCommand, type CommandHost } from "../core/command-bus";
import { TIDE_VERSION } from "../shared/contract";
import { COMMANDS, failure, scrub, tokenMatches, type CommandErrorCode, type CommandResult } from "../shared/commands";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BODY_LIMIT = 32_768;

export interface CommandServerOptions {
  token: string;
  host: CommandHost;
  readAllow: () => readonly string[];
  port: number;
  getSession?: () => Promise<unknown>;
  onClient?: (send: (event: unknown) => void) => void;
}

export interface RunningCommandServer {
  port: number;
  publish: (event: unknown) => void;
  close: () => Promise<void>;
}

/**
 * Loopback command bus. Writes require the bearer token plus an explicit allow
 * or a userData whitelist. The NetEase cookie is scrubbed from every payload.
 */
export function startCommandServer(options: CommandServerOptions): Promise<RunningCommandServer> {
  const sockets = new Set<Duplex>();
  let lastSession = "";

  const publish = (event: unknown) => {
    const frame = encodeText(JSON.stringify(scrub(event)));
    for (const socket of sockets) {
      try {
        socket.write(frame);
      } catch {
        sockets.delete(socket);
      }
    }
  };

  const server = http.createServer((req, res) => {
    void handle(req, res, options).catch(() => {
      if (res.headersSent) return;
      writeJson(res, 400, failure(null, "bad_args", "请求格式不正确"));
    });
  });

  server.on("upgrade", (req, socket) => {
    acceptWebSocket(req, socket, options, sockets);
  });

  const timer = setInterval(() => {
    if (!options.getSession || sockets.size === 0) return;
    void options.getSession().then((session) => {
      const clean = scrub(session);
      const encoded = JSON.stringify(clean);
      if (encoded === lastSession) return;
      lastSession = encoded;
      publish({ type: "session", session: clean });
    }).catch(() => undefined);
  }, 5000);
  timer.unref();

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(options.port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        publish,
        close: () => {
          clearInterval(timer);
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: CommandServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, { ok: true, service: "tide-bus", version: TIDE_VERSION, commands: COMMANDS });
    return;
  }
  if (url.pathname !== "/command") {
    writeJson(res, 404, failure(null, "bad_command", "没有这个接口"));
    return;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, failure(null, "bad_command", "请求方法不对"));
    return;
  }
  if (!authorized(req, options.token)) {
    writeJson(res, 401, failure(null, "unauthorized", "需要本机指令令牌"));
    return;
  }
  const request = await readJson(req);
  const result = await dispatchCommand(request, options.host, options.readAllow());
  writeJson(res, statusFor(result), result);
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return tokenMatches(header.slice("Bearer ".length).trim(), token);
}

function statusFor(result: CommandResult): number {
  if (result.ok) return 200;
  return statusForError(result.error);
}

function statusForError(error: CommandErrorCode): number {
  switch (error) {
    case "unauthorized":
      return 401;
    case "denied":
      return 403;
    case "unsupported":
      return 501;
    case "bad_command":
    case "bad_args":
      return 400;
    default:
      return 502;
  }
}

function acceptWebSocket(
  req: http.IncomingMessage,
  socket: Duplex,
  options: CommandServerOptions,
  sockets: Set<Duplex>,
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const key = req.headers["sec-websocket-key"];
  if (url.pathname !== "/events" || typeof key !== "string") {
    socket.destroy();
    return;
  }
  const provided = url.searchParams.get("token") ?? "";
  if (!tokenMatches(provided, options.token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + WS_MAGIC).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sockets.add(socket);
  const send = (event: unknown) => {
    try {
      socket.write(encodeText(JSON.stringify(scrub(event))));
    } catch {
      sockets.delete(socket);
    }
  };
  options.onClient?.(send);
  send({ type: "ready", service: "tide-bus", version: TIDE_VERSION });
  socket.on("data", (chunk: Buffer | string) => {
    const frame = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (frame.length > 0 && (frame[0] & 0x0f) === 0x8) {
      sockets.delete(socket);
      socket.end();
    }
  });
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
}

function encodeText(text: string): Buffer {
  const payload = Buffer.from(text);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
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
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", () => reject(new Error("bad_json")));
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(scrub(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
