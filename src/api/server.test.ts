import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { createTideApiServer } from "./server";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected a tcp port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("tide api", () => {
  const server = createTideApiServer({ cookieFile: null });
  let port = 0;

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  before(async () => {
    port = await listen(server);
  });

  it("answers /health on loopback", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; service: string; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, "tide");
    assert.equal(body.version, "0.9.1");
  });

  it("returns 404 for other paths", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/login`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
  });
});
