import http from "node:http";
import path from "node:path";
import { API_READY_PREFIX, DEFAULT_API_PORT, TIDE_VERSION } from "../shared/contract";

/**
 * Loopback API for 潮汐 Tide.
 * M1 serves GET /health only.
 * M2 mounts NeteaseCloudMusicApi on this same server; do that inside
 * `createTideApiServer` rather than spawning a second process.
 */
export function createTideApiServer(): http.Server {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "GET" && pathname === "/health") {
      writeJson(res, 200, { ok: true, service: "tide", version: TIDE_VERSION });
      return;
    }
    writeJson(res, 404, { ok: false, error: "not_found" });
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
