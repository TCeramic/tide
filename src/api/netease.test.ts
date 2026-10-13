import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { readPlaylists, readQrCheck, readQrImage, readQrKey, readSearch, readSongUrl, readUser } from "./netease";

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
    assert.equal(typeof ncm.cloudsearch, "function");
    assert.equal(typeof ncm.song_url, "function");
  });

  it("grays tracks that have no playable privilege", () => {
    assert.deepEqual(
      readSearch({
        body: {
          code: 200,
          result: {
            songs: [
              { id: 1, name: "青花瓷", dt: 1000.8, ar: [{ name: "周杰伦" }], privilege: { st: 0, pl: 128000 } },
              { id: 2, name: "灰色", dt: 1000, ar: [{ name: "甲" }, { name: "乙" }], privilege: { st: -100, pl: 0 } },
              { id: 3, name: "缺特权", dt: 1000 },
            ],
          },
        },
      }),
      [
        { id: "1", title: "青花瓷", artist: "周杰伦", durationMs: 1000, playable: true },
        { id: "2", title: "灰色", artist: "甲 / 乙", durationMs: 1000, playable: false },
        { id: "3", title: "缺特权", artist: "未知", durationMs: 1000, playable: false },
      ],
    );
    assert.throws(() => readSearch({ body: { code: 301 } }), /signed_out/);
  });

  it("accepts only http(s) song urls", () => {
    assert.deepEqual(
      readSongUrl({ body: { code: 200, data: [{ url: "https://m.music.126.net/a.mp3", code: 200 }] } }),
      { url: "https://m.music.126.net/a.mp3", signedOut: false },
    );
    assert.deepEqual(readSongUrl({ body: { code: 200, data: [{ url: null, code: 404 }] } }), {
      url: null,
      signedOut: false,
    });
    assert.deepEqual(readSongUrl({ body: { code: 301 } }), { url: null, signedOut: true });
    assert.deepEqual(readSongUrl({ body: { code: 200, data: [{ url: "javascript:alert(1)", code: 200 }] } }), {
      url: null,
      signedOut: false,
    });
  });
});
