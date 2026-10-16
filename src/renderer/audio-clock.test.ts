import assert from "node:assert/strict";
import { it } from "node:test";
import { bindAudioClock, readAudioClock, onAudioClockChange } from "./audio-clock";

it("reads the audio clock between IPC updates and follows pause/seek exactly", () => {
  const audio = Object.assign(new EventTarget(), { currentTime:1, paused:false, ended:false });
  const stop = bindAudioClock(audio as unknown as HTMLAudioElement, () => "one");
  assert.equal(readAudioClock("one")?.positionMs,1000);
  audio.currentTime = 1.016;
  assert.equal(readAudioClock("one")?.positionMs,1016);
  audio.paused = true; audio.currentTime = .5;
  assert.deepEqual(readAudioClock("one"),{ id:"one",positionMs:500,playing:false });
  assert.equal(readAudioClock("old"),null);
  stop(); assert.equal(readAudioClock("one"),null);
});
it("audio playback wakes the frame loop and disposal removes listeners", () => {
  const audio = Object.assign(new EventTarget(), { currentTime:0, paused:true, ended:false });
  let calls = 0; const unsubscribe = onAudioClockChange(() => { calls++; });
  const stop = bindAudioClock(audio as unknown as HTMLAudioElement, () => "one");
  audio.dispatchEvent(new Event("play")); assert.equal(calls,1);
  stop(); const before = calls; audio.dispatchEvent(new Event("play")); assert.equal(calls,before);
  unsubscribe();
});
