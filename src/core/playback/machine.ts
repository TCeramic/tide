import { EventBus } from "../events";
import type { PlaybackErrorCode, PlaybackEvents, PlaybackSnapshot, Track } from "./types";

const DEFAULT_VOLUME = 0.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneTrack(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationMs: track.durationMs,
  };
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

    const following = this.snapshot.index + 1;
    if (following < this.snapshot.queue.length) {
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

  private currentTrack(): Track | null {
    if (this.snapshot.index < 0) return null;
    return this.snapshot.queue[this.snapshot.index] ?? null;
  }
}
