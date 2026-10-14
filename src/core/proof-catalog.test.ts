import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogFromPlaylists, latticeRecords } from "./proof-catalog";

describe("proof catalog", () => {
  it("grows playlist to artist to song", () => {
    const catalog = catalogFromPlaylists([
      {
        id: "pl",
        name: "夜航",
        songs: [
          { id: "1", title: "潮声", artist: "海湾" },
          { id: "2", title: "折光", artist: "星尘" },
        ],
      },
    ]);
    const byId = new Map(catalog.nodes.map((node) => [node.id, node]));
    const root = byId.get(catalog.rootId);
    assert.ok(root);
    assert.deepEqual(root?.deps, ["pl"]);
    const playlist = byId.get("pl");
    assert.equal(playlist?.kind, "playlist");
    assert.equal(playlist?.deps.length, 2);
    const artists = playlist?.deps.map((id) => byId.get(id));
    assert.deepEqual(artists?.map((node) => node?.name).sort(), ["星尘", "海湾"]);
    for (const artist of artists ?? []) {
      assert.equal(artist?.kind, "artist");
      for (const songId of artist?.deps ?? []) {
        const song = byId.get(songId);
        assert.equal(song?.kind, "song");
        assert.equal(song?.leaf, true);
        assert.equal(song?.deps.length, 0);
      }
    }
    const records = latticeRecords(catalog.nodes);
    assert.equal(records.get("1")?.leaf, true);
    assert.equal(records.get("1")?.t.kind, "axiom");
    assert.equal(records.get("pl")?.t.kind, "theorem");
  });
});
