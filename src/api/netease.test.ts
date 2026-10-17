import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { createNeteaseClient, markLiked, readCatalog, readCollect, readCoverUrl, readDailySongs, readLikeIds, readLoginRefresh, readLyricBundle, readLyricText, readPersonalFm, readPlaylistTracks, readPlaylists, readQrCheck, readQrImage, readQrKey, readRadarId, readSearch, readSimilar, readSongUrl, readUser } from "./netease";

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
            { id: 9, name: "神音天2333喜欢的音乐", trackCount: 3, specialType: 5 },
            { id: 8, name: "普通歌单", trackCount: 1, specialType: 0 },
            { id: "skip" },
          ],
        },
      }),
      [
        { id: "9", name: "神音天2333喜欢的音乐", trackCount: 3, specialType: 5 },
        { id: "8", name: "普通歌单", trackCount: 1, specialType: 0 },
      ],
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
    assert.equal(typeof ncm.song_url_v1, "function");
    assert.equal(typeof ncm.personal_fm, "function");
    assert.equal(typeof ncm.fm_trash, "function");
    assert.equal(typeof ncm.login_refresh, "function");
    assert.equal(typeof ncm.playlist_track_all, "function");
    assert.equal(typeof ncm.recommend_songs, "function");
    assert.equal(typeof ncm.recommend_resource, "function");
    assert.equal(typeof ncm.simi_song, "function");
    assert.equal(typeof ncm.lyric, "function");
    assert.equal(typeof ncm.like, "function");
    assert.equal(typeof ncm.playlist_tracks, "function");
    assert.equal(typeof ncm.artist_songs, "function");
    assert.equal(typeof ncm.album, "function");
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

  it("reads playlist tracks from the privilege list and grays blocked ones", () => {
    assert.deepEqual(
      readPlaylistTracks({
        body: {
          code: 200,
          songs: [
            { id: 1, name: "青花瓷", dt: 1000, ar: [{ name: "周杰伦" }] },
            { id: 2, name: "灰色", dt: 1000, ar: [{ name: "未知" }] },
          ],
          privileges: [
            { id: 1, st: 0, pl: 128000 },
            { id: 2, st: -100, pl: 0 },
          ],
        },
      }),
      [
        { id: "1", title: "青花瓷", artist: "周杰伦", durationMs: 1000, playable: true },
        { id: "2", title: "灰色", artist: "未知", durationMs: 1000, playable: false },
      ],
    );
  });

  it("reads daily songs and keeps a row selectable when privilege is absent", () => {
    assert.deepEqual(
      readDailySongs({
        body: {
          code: 200,
          data: {
            dailySongs: [
              { id: 3, name: "有特权", dt: 1000, ar: [{ name: "甲" }], privilege: { st: 0, pl: 128000 } },
              { id: 4, name: "会员", dt: 1000, st: 0 },
              { id: 5, name: "下架", dt: 1000, st: -200 },
            ],
          },
        },
      }),
      [
        { id: "3", title: "有特权", artist: "甲", durationMs: 1000, playable: true },
        { id: "4", title: "会员", artist: "未知", durationMs: 1000, playable: true },
        { id: "5", title: "下架", artist: "未知", durationMs: 1000, playable: false },
      ],
    );
    assert.throws(() => readDailySongs({ body: { code: 301 } }), /signed_out/);
  });

  it("finds 私人雷达 and reports when that playlist is missing", () => {
    assert.equal(
      readRadarId({
        body: {
          code: 200,
          recommend: [
            { id: 7, name: "每日歌曲推荐" },
            { id: 42, name: "私人雷达" },
          ],
        },
      }),
      "42",
    );
    assert.throws(() => readRadarId({ body: { code: 200, recommend: [{ id: 7, name: "其他" }] } }), /radar_missing/);
    assert.throws(() => readRadarId({ body: { code: 301 } }), /signed_out/);
  });

  it("reads simi_song rows and lyric-search songs separately from artists", () => {
    assert.equal(readSimilar({
      body: { code: 200, songs: [{ id: 20, name: "相似", dt: 1000, ar: [{ name: "甲" }] }] },
    })[0]?.id, "20");
    assert.equal(readSimilar({
      body: { code: 200, songs: [{ id: 20, name: "相似", dt: 1000, ar: [{ name: "甲" }] }] },
    })[0]?.playable, true);
    const lyrics = readCatalog({
      body: { code: 200, result: { songs: [{ id: 9, name: "词", dt: 1000, ar: [{ name: "甲" }], privilege: { st: 0, pl: 1 } }] } },
    }, 1006);
    assert.equal(lyrics.hits[0]?.id, "9");
    assert.equal(lyrics.artists.length, 0);
    const artists = readCatalog({
      body: { code: 200, result: { artists: [{ id: 5, name: "周杰伦" }] } },
    }, 100);
    assert.equal(artists.artists[0]?.name, "周杰伦");
    assert.equal(artists.hits.length, 0);
    assert.equal(readLyricText({ body: { code: 200, lrc: { lyric: "[00:01.00]一句" } } }), "[00:01.00]一句");
    assert.deepEqual(readLyricBundle({
      body: {
        code: 200,
        lrc: { lyric: "[00:01.00]一句" },
        tlyric: { lyric: "[00:01.00]a line" },
        romalrc: { lyric: "[00:01.00]yi ju" },
      },
    }), {
      lyric: "[00:01.00]一句",
      translation: "[00:01.00]a line",
      romaji: "[00:01.00]yi ju",
      yrc: "",
      ytlrc: "",
    });
    assert.equal(readPersonalFm({
      body: { code: 200, data: [{ id: 4, name: "FM", duration: 1000, artists: [{ name: "甲" }] }] },
    })[0]?.title, "FM");
    assert.deepEqual(readLoginRefresh({ body: { code: 301 } }), { cookie: null, expired: true });
    assert.equal(readLoginRefresh({ body: { code: 200, cookie: "MUSIC_U=1" } }).expired, false);
  });

  it("reads liked ids and marks only those songs", () => {
    assert.deepEqual(readLikeIds({ body: { code: 200, ids: [347230, "186016", "nope"] } }), ["347230", "186016"]);
    assert.throws(() => readLikeIds({ body: { code: 301 } }), /signed_out/);
    const marked = markLiked([
      { id: "347230", title: "已知喜欢" },
      { id: "2", title: "未喜欢" },
    ], ["347230"]);
    assert.equal(marked[0]?.liked, true);
    assert.equal(marked[1]?.liked, false);
    const hinted = readSearch({
      body: {
        code: 200,
        result: { songs: [{ id: 9, name: "已喜欢", dt: 1000, ar: [{ name: "甲" }], liked: true, privilege: { st: 0, pl: 1 } }] },
      },
    });
    assert.equal(hinted[0]?.liked, true);
  });

  it("passes unlike as the string false so NeteaseCloudMusicApi does not treat it as a like", async () => {
    const received: unknown[] = [];
    const client = createNeteaseClient({
      async like(query: { like: string }) {
        received.push(query.like);
        return { status: 200, body: { code: 200 } };
      },
    } as never);
    await client.likeSong("1", false, "MUSIC_U=1");
    await client.likeSong("1", true, "MUSIC_U=1");
    assert.deepEqual(received, ["false", "true"]);
  });

  it("reads a duplicate collect from the nested playlist_tracks body", () => {
    const wrapped = (code: number, message: string) => ({
      status: 200,
      body: { status: 200, body: { code, message } },
    });
    assert.throws(
      () => readCollect(wrapped(502, "歌单内歌曲重复")),
      { message: "already_in_playlist" },
    );
    assert.throws(() => readCollect(wrapped(400, "参数错误")), { message: "collect_failed" });
    assert.doesNotThrow(() => readCollect(wrapped(200, "ok")));
  });

  it("keeps only http album art", () => {
    assert.equal(readCoverUrl({ al: { picUrl: "https://p1.music.126.net/cover.jpg" } }), "https://p1.music.126.net/cover.jpg");
    assert.equal(readCoverUrl({ album: { picUrl: "http://example.test/a.png" } }), "http://example.test/a.png");
    assert.equal(readCoverUrl({ al: { picUrl: "javascript:alert(1)" } }), null);
    assert.equal(readCoverUrl({ name: "无封面" }), null);
  });
});

it("keeps remote playlist artwork for cover cards",()=>{
 assert.equal(readPlaylists({body:{code:200,playlist:[{id:1,name:"one",coverImgUrl:"https://example.com/cover.jpg"}]}})[0].cover,"https://example.com/cover.jpg");
 assert.equal(readPlaylists({body:{code:200,playlist:[{id:1,name:"one",coverImgUrl:"javascript:bad"}]}})[0].cover,undefined);
});
