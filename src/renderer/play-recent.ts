import type { Track } from "../core/playback/types";
import type { TideBridge } from "../shared/contract";

type RecentBridge = Pick<TideBridge, "getPlayback" | "hardwareKey" | "queueMove" | "playNext" | "changeTrack">;

/** Activate a recent track without replacing the listening queue. */
export async function playRecentTrack(bridge: RecentBridge, track: Track): Promise<void> {
  const before = await bridge.getPlayback();
  if (before.queue[before.index]?.id === track.id) {
    await bridge.hardwareKey("play");
    return;
  }
  const existing = before.queue.findIndex(row => row.id === track.id);
  const inserted = existing >= 0
    ? await bridge.queueMove(existing, existing < before.index ? before.index : before.index + 1)
    : await bridge.playNext({ ...track, playable: true });
  const next = inserted.queue.findIndex(row => row.id === track.id);
  if (next >= 0) await bridge.changeTrack(next);
}
