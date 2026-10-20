import type { MotionValue } from '@/packs/_compat/motion';

/**
 * 宿主时钟。有音频时读 `<audio>.currentTime`；没有音频时是手动时间（播放时按墙钟推进），
 * 这样只上传字幕也能预览，截基线帧时也能精确 seek。
 */
export class HostClock implements MotionValue<number> {
  private audio: HTMLAudioElement | null = null;
  private manualTime = 0;
  private manualAnchor: { wall: number; time: number } | null = null;
  private rate = 1;
  private volume = 1;
  private muted = false;

  attachAudio(audio: HTMLAudioElement | null) {
    this.audio = audio;
    this.applyRate();
    this.applyVolume();
  }

  /** 预览音量（0–1）与静音。只影响预览的 `<audio>`，导出用解码后的音频，不受影响。 */
  setVolume(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.audio) return;
    this.audio.volume = this.volume;
    this.audio.muted = this.muted;
  }

  /** 试听速度（歌词面板的慢速试听）。保持音高；只影响预览，逐帧导出不看时钟。 */
  setRate(rate: number) {
    if (this.manualAnchor) this.manualAnchor = { wall: performance.now(), time: this.get() };
    this.rate = rate;
    this.applyRate();
  }

  private applyRate() {
    if (!this.audio) return;
    this.audio.preservesPitch = true;
    this.audio.playbackRate = this.rate;
  }

  private get audioActive() {
    return Boolean(this.audio?.currentSrc);
  }

  get(): number {
    if (this.audioActive) return this.audio!.currentTime;
    if (this.manualAnchor) return this.manualAnchor.time + ((performance.now() - this.manualAnchor.wall) / 1000) * this.rate;
    return this.manualTime;
  }

  get paused(): boolean {
    return this.audioActive ? this.audio!.paused : this.manualAnchor === null;
  }

  play() {
    if (this.audioActive) {
      void this.audio!.play();
    } else if (!this.manualAnchor) {
      this.manualAnchor = { wall: performance.now(), time: this.manualTime };
    }
  }

  pause() {
    if (this.audioActive) {
      this.audio!.pause();
    } else if (this.manualAnchor) {
      this.manualTime = this.get();
      this.manualAnchor = null;
    }
  }

  seek(time: number) {
    if (this.audioActive) {
      this.audio!.currentTime = time;
    } else if (this.manualAnchor) {
      this.manualAnchor = { wall: performance.now(), time };
    } else {
      this.manualTime = time;
    }
  }
}
