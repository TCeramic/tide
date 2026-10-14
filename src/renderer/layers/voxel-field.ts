import { readAudioEnergy } from "../audio-energy";

/**
 * A short field of cubes under the lyric stage.
 * Heights follow playback energy. This is Tide's own drawing, not a terrain port.
 */
export function paintVoxels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  playing: boolean,
): void {
  context.clearRect(0, 0, width, height);
  const energy = playing ? 0.25 + readAudioEnergy() * 0.75 : 0.08;
  const cols = 18;
  const rows = 8;
  const gapX = width / (cols + 1);
  const gapY = height / (rows + 2);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const wave = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + x * 0.45 + y * 0.7));
      const cube = (8 + wave * 28 * energy) * (1 - y / (rows + 2));
      const cx = gapX * (x + 1);
      const cy = height - gapY * (y + 1) - cube;
      context.fillStyle = `rgba(186, 236, 232, ${0.18 + energy * 0.45})`;
      context.fillRect(cx - cube * 0.35, cy, cube * 0.7, cube);
      context.fillStyle = `rgba(62, 198, 192, ${0.25 + energy * 0.4})`;
      context.fillRect(cx - cube * 0.35, cy, cube * 0.7, Math.max(2, cube * 0.18));
    }
  }
}
