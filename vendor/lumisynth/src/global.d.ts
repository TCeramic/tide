import type { PackId } from '@/compiler/types';

declare global {
  interface Window {
    /** 测试钩子，见 App.tsx。 */
    __lumi?: {
      loadLyrics(name: string, text: string): void;
      setPack(pack: PackId): void;
      setSeed(seed: string): void;
      setDark(dark: boolean): void;
      /** 深浅两套主题一起改（如写入 wordColors / lyricsIcons）。 */
      patchTheme(patch: Record<string, unknown>): void;
      setPostProcess(enabled: boolean): void;
      setSubtitles(mode: 'translation' | 'romanization' | 'none'): void;
      patchTuning(scope: string, patch: Record<string, unknown>): void;
      seek(time: number): void;
      renderOnce(): void;
      /** 丢掉已构建的场景，在当前时刻重建。 */
      rebuild(): void;
      /** 每挂载好一个 runtime 加一，测试靠它等待重建完成。 */
      runtimeGeneration: number;
      engine: 'kernel' | 'legacy';
      /** 编译参数换成与 folia 逐字段相等的那一组。 */
      setFoliaCompatible(): void;
      setMeta(meta: { title?: string; artist?: string; album?: string }): void;
      setTypography(patch: { lyrics?: Record<string, unknown>; subtitles?: Record<string, unknown> }): void;
      /** 画一张测试图（带透明）放进素材库，返回素材 id。 */
      addTestImage(name: string, color: string): Promise<string>;
      addClip(assetId: string, clip: Record<string, unknown>): string;
      /** 用 mediabunny 在页面里编一段测试视频（纯绿色条从左移到右）放进素材库，返回素材 id。 */
      addTestVideo(name: string, seconds: number): Promise<string>;
      addBackground(source: Record<string, unknown>, timing: Record<string, unknown>, patch?: Record<string, unknown>): string;
      /** 把 t 时刻要用的视频帧准备好（预览里等 <video> 定位完成）。 */
      prepareFrame(time: number): Promise<void>;
      /**
       * 分层导出的核对：解开 zip，按编号从下到上把各层在 time 时刻的帧叠起来（暗角层普通混合），
       * 与合成导出的同一帧比较，返回平均每通道差（0..255）、各层文件名、最上面一层里透明像素的比例。
       */
      compareLayers(zipBase64: string, compositeBase64: string, time: number): Promise<{ diff: number; files: string[]; transparentRatio: number }>;
      /** 解码一段视频（base64），返回各时刻测试色条的中心（横向比例；按色条完整、最长的那些行测，不受前景遮挡）。 */
      probeBar(base64: string, times: number[]): Promise<Array<number | null>>;
      updateClip(clipId: string, patch: Record<string, unknown>): void;
      /** 预览内核在 time 时刻给这个片段的跟随运镜变换。 */
      clipFollow(clipId: string, time: number): { a: number; b: number; c: number; d: number; tx: number; ty: number } | null;
      /** 预览渲染 time 这一帧，返回接近 color（#rrggbb）的像素的重心（逻辑像素）。 */
      colorCentroid(color: string, time: number): Promise<{ x: number; y: number; count: number } | null>;
      /** 解码一段视频（base64），返回各时刻接近 color 的像素的重心（按 720 高的逻辑像素）。 */
      videoCentroids(base64: string, times: number[], color: string): Promise<Array<{ x: number; y: number; count: number } | null>>;
      setDirection(direction: { mode?: 'single' | 'mix'; pack?: PackId; shotMixing?: boolean }): void;
      lockShot(paragraphIndex: number, shotIndex: number, style: string): void;
      setComponent(paragraphIndex: number, shotIndex: number, slot: string, value: string): void;
      inspect(): {
        paragraphs: Array<{
          startTime: number;
          endTime: number;
          pack: PackId;
          lines: number[];
          texts: string[];
          shots: Array<{ id: string; startTime: number; endTime: number; style: string; locked: boolean }>;
          transition: { id: string; startTime: number; endTime: number } | null;
        }>;
      };
    };
  }
}
