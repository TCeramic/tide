/** Latest playback energy in 0..1. The voxel field reads it; silence stays at 0. */
let energy = 0;

export function pushAudioEnergy(value: number): void {
  if (!Number.isFinite(value)) return;
  energy = Math.min(1, Math.max(0, value));
}

export function readAudioEnergy(): number {
  return energy;
}
