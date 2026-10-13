import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit } from "../shared/contract";
import { SIMILAR_API, buildTideToday, countsAsSkip, isThin, likedTargetFromSession, pickLikedPlaylistId, type ListenEvent } from "./tide-today";

function play(id: string, at: number, kind: ListenEvent["kind"] = "play"): ListenEvent {
  return { id, title: id, artist: "潮汐", durationMs: 1000, at, kind };
}

function hit(id: string, playable = true): SearchHit {
  return { id, title: id, artist: "喜欢", durationMs: 1000, playable };
}

describe("tide today", () => {
  it("explains an empty log before any similar songs exist", () => {
    const list = buildTideToday([], {});
    assert.deepEqual(list.hits, []);
    assert.match(list.message ?? "", /今日潮汐 · 探索/);
    assert.equal(isThin([]), true);
  });

  it("does not ask a logged-in user to log in when nothing similar comes back", () => {
    const list = buildTideToday([], { signedIn: true });
    assert.deepEqual(list.hits, []);
    assert.equal(list.message, "还没有收听记录，相似歌曲也没有找到。");
    assert.doesNotMatch(list.message ?? "", /登录/);
  });

  it("matches the classic name, a nickname liked list, and rejects lookalikes", () => {
    assert.equal(pickLikedPlaylistId([
      { id: "1", name: "华语" },
      { id: "2", name: "我喜欢的音乐" },
    ]), "2");
    assert.equal(pickLikedPlaylistId([
      { id: "3", name: "旅行" },
      { id: "4", name: "神音天2333喜欢的音乐" },
    ], "神音天2333"), "4");
    assert.equal(pickLikedPlaylistId([
      { id: "5", name: "喜欢的音乐合集" },
      { id: "6", name: "私人雷达" },
    ]), null);
    assert.equal(pickLikedPlaylistId([
      { id: "7", name: "别人喜欢的音乐", specialType: 0 },
      { id: "8", name: "红心", specialType: 5 },
    ]), "8");
  });

  it("reads a logged-in session and ignores a signed-out one", () => {
    assert.deepEqual(likedTargetFromSession({
      ok: true,
      state: "logged_in",
      user: { nickname: "神音天2333" },
      playlists: [
        { id: "11", name: "喜欢的音乐合集" },
        { id: "12", name: "神音天2333喜欢的音乐", specialType: 5 },
      ],
    }), { signedIn: true, playlistId: "12" });
    assert.deepEqual(likedTargetFromSession({
      ok: true,
      state: "logged_in",
      user: { nickname: "神音天2333" },
      playlists: [{ id: "13", name: "日推" }],
    }), { signedIn: true, playlistId: null });
    assert.deepEqual(likedTargetFromSession({
      ok: true,
      state: "signed_out",
      playlists: [{ id: "2", name: "我喜欢的音乐" }],
    }), { signedIn: false, playlistId: null });
  });

  it("keeps heard ids and adds unheard ids from similar songs, not a daily split", () => {
    const events = [
      play("1", 1),
      play("1", 2),
      play("2", 3),
      play("2", 4, "skip"),
      play("3", 5),
      play("4", 6),
      play("5", 7),
    ];
    assert.equal(isThin(events), false);
    assert.equal(SIMILAR_API, "simi_song");
    const list = buildTideToday(events, {
      signedIn: true,
      similar: [hit("20"), hit("21"), hit("22"), hit("23"), hit("24"), hit("25"), hit("26"), hit("27")],
      daily: [hit("30"), hit("31")],
    });
    const ids = list.hits.map((item) => item.id);
    assert.ok(ids.includes("1"));
    assert.ok(ids.includes("20"));
    assert.equal(ids.includes("30"), false);
    assert.equal(list.hits.every((item) => item.playable), true);
  });

  it("uses daily recommend only when similar songs are scarce, and says so when they fail", () => {
    const scarce = buildTideToday([play("1", 1)], {
      signedIn: true,
      similar: [hit("1"), hit("2", false), hit("3")],
      daily: [hit("30")],
    });
    assert.deepEqual(scarce.hits.map((item) => item.id), ["1", "2", "3", "30"]);
    const failed = buildTideToday([play("1", 1)], { signedIn: true, similarFailed: true });
    assert.match(failed.message ?? "", /相似歌曲暂时没有拉到/);
  });

  it("counts an early exit while the track is still starting, and not a finished listen", () => {
    assert.equal(countsAsSkip("playing", 29_999), true);
    assert.equal(countsAsSkip("loading", 0), true);
    assert.equal(countsAsSkip("playing", 30_000), false);
    assert.equal(countsAsSkip("paused", 0), false);
  });
});
