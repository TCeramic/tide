/** Playlist → artist → song, shaped for the Lattice proof tree. */

export interface ProofSong {
  id: string;
  title: string;
  artist: string;
}

export interface ProofPlaylist {
  id: string;
  name: string;
  songs: readonly ProofSong[];
}

export interface LatticeNode {
  id: string;
  name: string;
  deps: string[];
  leaf: boolean;
  kind: "library" | "playlist" | "artist" | "song";
}

export interface LatticeRecord {
  deps: string[];
  leaf: boolean;
  t: { kind: "theorem" | "definition" | "axiom"; name: string };
}

const KIND = {
  library: "theorem",
  playlist: "theorem",
  artist: "definition",
  song: "axiom",
} as const;

/** One library root. Playlists branch into artists, songs are the leaves. */
export function catalogFromPlaylists(playlists: readonly ProofPlaylist[]): {
  rootId: string;
  nodes: LatticeNode[];
} {
  const nodes: LatticeNode[] = [];
  const rootDeps: string[] = [];
  playlists.forEach((playlist, playlistIndex) => {
    const playlistId = safeId(playlist.id, `playlist-${playlistIndex}`);
    rootDeps.push(playlistId);
    const byArtist = new Map<string, ProofSong[]>();
    for (const song of playlist.songs) {
      const artist = song.artist.trim() || "未知";
      const bucket = byArtist.get(artist) ?? [];
      bucket.push(song);
      byArtist.set(artist, bucket);
    }
    const artistIds: string[] = [];
    let artistIndex = 0;
    for (const [artist, songs] of byArtist) {
      const artistId = `${playlistId}/artist-${artistIndex}`;
      artistIndex += 1;
      artistIds.push(artistId);
      const songIds: string[] = [];
      songs.forEach((song, songIndex) => {
        const songId = safeId(song.id, `${artistId}/song-${songIndex}`);
        songIds.push(songId);
        nodes.push({
          id: songId,
          name: song.title.trim() || "未命名",
          deps: [],
          leaf: true,
          kind: "song",
        });
      });
      nodes.push({
        id: artistId,
        name: artist,
        deps: songIds,
        leaf: songIds.length === 0,
        kind: "artist",
      });
    }
    nodes.push({
      id: playlistId,
      name: playlist.name.trim() || "歌单",
      deps: artistIds,
      leaf: artistIds.length === 0,
      kind: "playlist",
    });
  });
  const rootId = "library";
  nodes.push({
    id: rootId,
    name: "潮汐",
    deps: rootDeps,
    leaf: rootDeps.length === 0,
    kind: "library",
  });
  return { rootId, nodes };
}

export function latticeRecords(nodes: readonly LatticeNode[]): Map<string, LatticeRecord> {
  const map = new Map<string, LatticeRecord>();
  for (const node of nodes) {
    map.set(node.id, {
      deps: node.deps,
      leaf: node.leaf,
      t: { kind: KIND[node.kind], name: node.name },
    });
  }
  return map;
}

export const DEMO_PLAYLISTS: ProofPlaylist[] = [
  {
    id: "demo-tide",
    name: "今日潮汐",
    songs: [
      { id: "demo-1", title: "潮声", artist: "海湾" },
      { id: "demo-2", title: "夜航", artist: "海湾" },
      { id: "demo-3", title: "折光", artist: "星尘" },
    ],
  },
];

function safeId(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : fallback;
}
