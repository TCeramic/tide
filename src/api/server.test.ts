import { version as packageVersion } from "../../package.json";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import type { NeteaseClient } from './netease';
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
    assert.equal(body.version, packageVersion);
  });

  it("returns 404 for other paths", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/login`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
  });
});

it('relays resolved audio with ranges and CORS while rejecting unknown relay tokens',async()=>{
 const bytes=Buffer.from('0123456789abcdefghijkl');
 const upstream=http.createServer((req,res)=>{const range=req.headers.range;const data=range?bytes.subarray(2,6):bytes;res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':data.length,...(range?{'Content-Range':`bytes 2-5/${bytes.length}`}:{})});res.end(data);});
 const upstreamPort=await listen(upstream);
 const api=createTideApiServer({cookieFile:null,netease:{songUrl:async()=>({url:`http://127.0.0.1:${upstreamPort}/test.wav`,signedOut:false})} as unknown as NeteaseClient});
 const port=await listen(api);
 try{const media=await (await fetch(`http://127.0.0.1:${port}/song/url?id=1`)).json() as {url:string};
  assert.match(media.url,/\/media\/[a-f\d-]+$/);
  const audio=await fetch(media.url,{headers:{Range:'bytes=2-5'}});assert.equal(audio.status,206);assert.equal(audio.headers.get('access-control-allow-origin'),'*');assert.equal(await audio.text(),'2345');
  assert.equal((await fetch(`http://127.0.0.1:${port}/media/unknown`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/session`)).headers.get('access-control-allow-origin'),null);
 }finally{api.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>api.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);}
});
