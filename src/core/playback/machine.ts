import { EventBus } from "../events";
import { followingIndex, previousIndex, type RepeatMode } from "./order";
import { moveQueueItem, removeQueueItem } from "./queue-edit";
import type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, Track } from "./types";

const DEFAULT_VOLUME = 0.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneTrack(track: Track): Track {
  const next: Track = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationMs: track.durationMs,
  };
  if (typeof track.albumTitle === "string") next.albumTitle = track.albumTitle.slice(0, 200);
  if (typeof track.albumId === "string") next.albumId = track.albumId.slice(0, 40);
  if (typeof track.cover === "string" && /^https?:\/\//.test(track.cover)) next.cover = track.cover.slice(0, 500);
  return next;
}

/**
 * Playback kernel. The audio element owns the clock; `syncPosition` records it.
 * `beginLoad` / `completeLoad` bracket a URL lookup. `resume` continues a paused track.
 */
export class PlaybackMachine {
  readonly events = new EventBus<PlaybackEvents>();

  private snapshot: PlaybackSnapshot = {
    status: "idle",
    queue: [],
    index: -1,
    positionMs: 0,
    volume: DEFAULT_VOLUME,
    error: null,
    repeat: "all",
    shuffle: false,
    explore: false,
  };

  getState(): PlaybackSnapshot {
    return {
      ...this.snapshot,
      queue: this.snapshot.queue.map(cloneTrack),
    };
  }

  play(): PlaybackSnapshot {
    if (this.snapshot.status === "playing") return this.getState();
    if (this.snapshot.status === "paused" && this.currentTrack()) return this.resume();
    if (this.snapshot.status !== "loading") this.beginLoad();
    if (this.snapshot.status === "error") {
      const snapshot = this.getState();
      this.events.emit("play", { snapshot });
      return snapshot;
    }
    return this.completeLoad();
  }

  resume(): PlaybackSnapshot {
    if (this.snapshot.status !== "paused" || !this.currentTrack()) return this.getState();
    this.snapshot = { ...this.snapshot, status: "playing", error: null };
    const snapshot = this.getState();
    this.events.emit("play", { snapshot });
    return snapshot;
  }

  /** Record the audio element's position without emitting `seek`. */
  syncPosition(positionMs: number): PlaybackSnapshot {
    const track = this.currentTrack();
    if (!track || this.snapshot.status !== "playing" || !Number.isFinite(positionMs)) return this.getState();
    this.snapshot = { ...this.snapshot, positionMs: clamp(positionMs, 0, track.durationMs) };
    return this.getState();
  }

  /** Audio metadata supplies the duration for local/unknown-length tracks. */
  reportDuration(id: string, durationMs: number): PlaybackSnapshot {
    const track = this.currentTrack();
    if (!track || track.id !== id || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 86400000 || (track.durationMs > 0 && !id.startsWith("local-"))) return this.getState();
    const queue = this.snapshot.queue.map((item, index) => index === this.snapshot.index ? { ...item, durationMs: Math.round(durationMs) } : item);
    this.snapshot = { ...this.snapshot, queue };
    const snapshot = this.getState(); this.events.emit("queue", { snapshot }); return snapshot;
  }

  beginLoad(): PlaybackSnapshot {
    if (!this.currentTrack()) {
      return this.fail("empty_queue");
    }
    this.snapshot = { ...this.snapshot, status: "loading", error: null };
    return this.getState();
  }

  completeLoad(): PlaybackSnapshot {
    if (this.snapshot.status !== "loading") return this.getState();
    if (!this.currentTrack()) return this.fail("empty_queue");
    this.snapshot = { ...this.snapshot, status: "playing", error: null };
    const snapshot = this.getState();
    this.events.emit("play", { snapshot });
    return snapshot;
  }

  fail(error: PlaybackErrorCode): PlaybackSnapshot {
    this.snapshot = { ...this.snapshot, status: "error", error };
    return this.getState();
  }

  pause(): PlaybackSnapshot {
    if (this.snapshot.status !== "playing") return this.getState();
    this.snapshot = { ...this.snapshot, status: "paused" };
    const snapshot = this.getState();
    this.events.emit("pause", { snapshot });
    return snapshot;
  }

  /** Pause and return to the start of the current track. One stop, not a toggle. */
  stop(): PlaybackSnapshot {
    if (!this.currentTrack()) return this.getState();
    const playing = this.snapshot.status === "playing";
    this.snapshot = { ...this.snapshot, status: "paused", positionMs: 0, error: null };
    const snapshot = this.getState();
    if (playing) this.events.emit("pause", { snapshot });
    this.events.emit("seek", { positionMs: 0, snapshot });
    return snapshot;
  }

  seek(positionMs: number): PlaybackSnapshot {
    const track = this.currentTrack();
    if (!track || !Number.isFinite(positionMs)) return this.getState();
    const next = clamp(positionMs, 0, track.durationMs);
    this.snapshot = { ...this.snapshot, positionMs: next };
    const snapshot = this.getState();
    this.events.emit("seek", { positionMs: next, snapshot });
    return snapshot;
  }

  setVolume(volume: number): PlaybackSnapshot {
    if (!Number.isFinite(volume)) return this.getState();
    const next = clamp(volume, 0, 1);
    this.snapshot = { ...this.snapshot, volume: next };
    const snapshot = this.getState();
    this.events.emit("volume", { volume: next, snapshot });
    return snapshot;
  }

  setQueue(queue: Track[], index = 0): PlaybackSnapshot {
    const clean = queue.map(cloneTrack);
    if (clean.length === 0) {
      this.snapshot = {
        ...this.snapshot,
        status: "idle",
        queue: [],
        index: -1,
        positionMs: 0,
        error: null,
        repeat: this.snapshot.repeat,
        shuffle: this.snapshot.shuffle,
        explore: this.snapshot.explore,
      };
      const snapshot = this.getState();
      this.events.emit("queue", { snapshot });
      return snapshot;
    }

    const nextIndex = clamp(Math.trunc(index), 0, clean.length - 1);
    const keepLive = this.snapshot.status === "playing" || this.snapshot.status === "loading";
    this.snapshot = {
      ...this.snapshot,
      status: keepLive ? this.snapshot.status : "paused",
      queue: clean,
      index: nextIndex,
      positionMs: 0,
      error: null,
    };
    const snapshot = this.getState();
    this.events.emit("queue", { snapshot });
    this.events.emit("track-change", { index: nextIndex, snapshot: this.getState() });
    return this.getState();
  }

  changeTrack(index: number): PlaybackSnapshot {
    if (this.snapshot.queue.length === 0) return this.fail("empty_queue");
    if (!Number.isInteger(index) || index < 0 || index >= this.snapshot.queue.length) {
      return this.fail("track_missing");
    }
    const keepLive = this.snapshot.status === "playing" || this.snapshot.status === "loading";
    this.snapshot = {
      ...this.snapshot,
      index,
      positionMs: 0,
      status: keepLive ? "playing" : "paused",
      error: null,
    };
    const snapshot = this.getState();
    this.events.emit("track-change", { index, snapshot });
    return snapshot;
  }

  /**
   * Move the playhead while `playing`. Returns true when the machine
   * crossed a track boundary or paused at the end of the queue.
   */
  tick(deltaMs: number): boolean {
    if (this.snapshot.status !== "playing" || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return false;
    }
    const track = this.currentTrack();
    if (!track) return false;
    const next = this.snapshot.positionMs + deltaMs;
    if (next < track.durationMs) {
      this.snapshot = { ...this.snapshot, positionMs: next };
      return false;
    }

    return this.finishFrom(track);
  }

  setRepeat(repeat: RepeatMode): PlaybackSnapshot {
    if (repeat !== "off" && repeat !== "all" && repeat !== "one") return this.getState();
    this.snapshot = { ...this.snapshot, repeat };
    return this.getState();
  }

  setShuffle(shuffle: boolean): PlaybackSnapshot {
    this.snapshot = { ...this.snapshot, shuffle };
    return this.getState();
  }

  setExplore(explore: boolean): PlaybackSnapshot {
    this.snapshot = { ...this.snapshot, explore };
    return this.getState();
  }

  removeAt(index: number): PlaybackSnapshot {
    const edited = removeQueueItem(this.snapshot.queue, this.snapshot.index, index);
    if (!edited) return this.getState();
    return this.applyQueueEdit(edited.queue, edited.index, edited.trackChanged);
  }

  moveTrack(from: number, to: number): PlaybackSnapshot {
    const edited = moveQueueItem(this.snapshot.queue, this.snapshot.index, from, to);
    if (!edited) return this.getState();
    return this.applyQueueEdit(edited.queue, edited.index, edited.trackChanged);
  }

  clearQueue(): PlaybackSnapshot {
    return this.setQueue([]);
  }

  /** Append tracks that are not already queued. The current index stays put. */
  appendTracks(tracks: readonly Track[]): PlaybackSnapshot {
    const seen = new Set(this.snapshot.queue.map((track) => track.id));
    const extra = tracks.map(cloneTrack).filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
    if (extra.length === 0) return this.getState();
    this.snapshot = { ...this.snapshot, queue: [...this.snapshot.queue, ...extra] };
    const snapshot = this.getState();
    this.events.emit("queue", { snapshot });
    return snapshot;
  }

  replaceUpcoming(tracks: readonly Track[]): PlaybackSnapshot {
    const history = this.snapshot.queue.slice(0, this.snapshot.index + 1);
    const currentId = history.at(-1)?.id;
    const fresh = [...new Map(tracks.map(cloneTrack).filter(track => track.id !== currentId).map(track => [track.id, track])).values()];
    this.snapshot = { ...this.snapshot, queue: [...history, ...fresh] };
    const snapshot = this.getState(); this.events.emit("queue", { snapshot }); return snapshot;
  }

  /** Place a track so it plays after the current one. */
  insertNext(track: Track): PlaybackSnapshot {
    const clean = cloneTrack(track);
    const queue = this.snapshot.queue.filter((item) => item.id !== clean.id);
    let index = this.snapshot.index;
    if (index >= queue.length) index = queue.length - 1;
    const removedBefore = this.snapshot.queue.findIndex((item) => item.id === clean.id);
    if (removedBefore >= 0 && removedBefore < this.snapshot.index) index -= 1;
    const at = index < 0 ? queue.length : index + 1;
    queue.splice(at, 0, clean);
    this.snapshot = { ...this.snapshot, queue, index: Math.max(index, 0) };
    const snapshot = this.getState();
    this.events.emit("queue", { snapshot });
    return snapshot;
  }

  nextIndex(): number | null {
    return followingIndex(
      this.snapshot.queue.length,
      this.snapshot.index,
      this.snapshot.repeat,
      this.snapshot.shuffle,
    );
  }

  previousIndex(): number | null {
    return previousIndex(this.snapshot.queue.length, this.snapshot.index, this.snapshot.repeat);
  }

  /**
   * The current track ended. Single repeat restarts it. Otherwise follow
   * the repeat and shuffle rules, or pause on the last track.
   */
  finish(): PlaybackSnapshot {
    const track = this.currentTrack();
    if (!track || this.snapshot.status !== "playing") return this.getState();
    this.finishFrom(track);
    return this.getState();
  }

  private finishFrom(track: Track): boolean {
    if (this.snapshot.repeat === "one") {
      this.snapshot = { ...this.snapshot, positionMs: 0, status: "playing", error: null };
      this.events.emit("track-change", { index: this.snapshot.index, snapshot: this.getState() });
      return true;
    }
    const following = followingIndex(
      this.snapshot.queue.length,
      this.snapshot.index,
      this.snapshot.repeat,
      this.snapshot.shuffle,
    );
    if (following != null) {
      this.snapshot = {
        ...this.snapshot,
        index: following,
        positionMs: 0,
        status: "playing",
        error: null,
      };
      this.events.emit("track-change", { index: following, snapshot: this.getState() });
      return true;
    }
    this.snapshot = { ...this.snapshot, positionMs: track.durationMs, status: "paused" };
    this.events.emit("pause", { snapshot: this.getState() });
    return true;
  }

  private applyQueueEdit(queue: Track[], index: number, trackChanged: boolean): PlaybackSnapshot {
    if (queue.length === 0) return this.setQueue([]);
    this.snapshot = {
      ...this.snapshot,
      queue,
      index,
      positionMs: trackChanged ? 0 : this.snapshot.positionMs,
      error: null,
    };
    const snapshot = this.getState();
    this.events.emit("queue", { snapshot });
    if (trackChanged) this.events.emit("track-change", { index, snapshot: this.getState() });
    return this.getState();
  }

  private currentTrack(): Track | null {
    if (this.snapshot.index < 0) return null;
    return this.snapshot.queue[this.snapshot.index] ?? null;
  }
}
