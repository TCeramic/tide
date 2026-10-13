import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { API_READY_PREFIX, type HealthStatus } from "../shared/contract";

export interface ApiProcess {
  /** Resolves with the bound loopback port once `/health` can be called. */
  ready: Promise<number>;
  /** Idempotent. Safe to call before `ready` settles. */
  stop: () => void;
}

const READY_TIMEOUT_MS = 8000;
const STOP_GRACE_MS = 1500;

/**
 * Spawn the loopback API as a child of the Electron process.
 * `ELECTRON_RUN_AS_NODE` lets the same binary act as Node when the app is packaged.
 */
export function startApiProcess(serverPath: string, port: number): ApiProcess {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TIDE_API_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let settled = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectReady: (error: Error) => void = () => undefined;

  const ready = new Promise<number>((resolve, reject) => {
    rejectReady = reject;
    let stdout = "";
    readyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killChild(child);
      reject(new Error("API child did not become ready"));
    }, READY_TIMEOUT_MS);

    const finish = (error: Error | null, bound?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      if (error || bound == null) {
        killChild(child);
        reject(error ?? new Error("API child failed"));
        return;
      }
      resolve(bound);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      let newline = stdout.indexOf("\n");
      while (newline !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
        if (!line.startsWith(API_READY_PREFIX)) continue;
        const bound = Number(line.slice(API_READY_PREFIX.length));
        if (!Number.isInteger(bound) || bound <= 0) {
          finish(new Error(`Bad API ready line: ${line}`));
          return;
        }
        finish(null, bound);
        return;
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      process.stderr.write(`[tide-api] ${chunk}`);
    });

    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`API child exited before ready (${code ?? "null"})`));
    });
  });

  return {
    ready,
    stop: () => {
      clearTimeout(readyTimer);
      if (!settled) {
        settled = true;
        rejectReady(new Error("API start cancelled"));
      }
      killChild(child);
    },
  };
}

export function checkHealth(port: number): Promise<HealthStatus> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status: HealthStatus) => {
      if (done) return;
      done = true;
      resolve(status);
    };

    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/health", timeout: 1000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            finish({ ok: false, port, error: `http_${res.statusCode ?? 0}` });
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              ok?: boolean;
              service?: string;
            };
            finish({
              ok: body.ok === true,
              service: typeof body.service === "string" ? body.service : undefined,
              port,
              error: body.ok === true ? null : "unhealthy",
            });
          } catch {
            finish({ ok: false, port, error: "bad_json" });
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      finish({ ok: false, port, error: "timeout" });
    });
    req.on("error", () => finish({ ok: false, port, error: "unreachable" }));
  });
}

export function serverBundlePath(): string {
  return path.join(__dirname, "api", "server.js");
}

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null || child.signalCode !== null || child.pid == null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, STOP_GRACE_MS);
  child.once("exit", () => clearTimeout(timer));
  timer.unref();
}
