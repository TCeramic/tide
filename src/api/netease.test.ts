import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { readPlaylists, readQrCheck, readQrImage, readQrKey, readUser } from "./netease";

describe("netease adapters", () => {
  it("reads a logged-in account and ignores anonymous sessions", () => {
    assert.deepEqual(
      readUser({
        body: {
          data: {
            code: 200,
            account: { id: 7, anonimousUser: false },
            profile: { userId: 7, nickname: "潮友" },
          },
        },
      }),
      { id: "7", nickname: "潮友" },
    );
    assert.equal(
      readUser({
        body: { data: { code: 200, account: { id: 1, anonimousUser: true } } },
      }),
      null,
    );
    assert.equal(readUser({ body: { code: 301 } }), null);
  });

  it("reads playlists and qr payloads", () => {
    assert.deepEqual(
      readPlaylists({
        body: {
          code: 200,
          playlist: [
            { id: 9, name: "我喜欢的音乐", trackCount: 3 },
            { id: "skip" },
          ],
        },
      }),
      [{ id: "9", name: "我喜欢的音乐", trackCount: 3 }],
    );
    assert.equal(readQrKey({ body: { data: { unikey: "abc" } } }), "abc");
    assert.deepEqual(
      readQrImage({
        body: {
          data: {
            qrurl: "https://music.163.com/login?codekey=abc",
            qrimg: "data:image/png;base64,aaa",
          },
        },
      }),
      {
        qrurl: "https://music.163.com/login?codekey=abc",
        qrimg: "data:image/png;base64,aaa",
      },
    );
    assert.deepEqual(readQrCheck({ body: { code: 801, cookie: "NMTID=1" } }), {
      code: 801,
      cookie: "NMTID=1",
    });
  });

  it("loads the pinned NeteaseCloudMusicApi exports", () => {
    const require = createRequire(`${process.cwd()}/package.json`);
    const ncm = require("NeteaseCloudMusicApi") as Record<string, unknown>;
    assert.equal(typeof ncm.login_qr_key, "function");
    assert.equal(typeof ncm.login_qr_create, "function");
    assert.equal(typeof ncm.login_qr_check, "function");
    assert.equal(typeof ncm.login_status, "function");
    assert.equal(typeof ncm.user_playlist, "function");
  });
});
