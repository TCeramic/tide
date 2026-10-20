export interface LumiLine {
  words: Array<{ text: string; startTime: number; endTime: number }>;
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  romanization?: string;
  sourceHash?: string;
}

export interface LumiKernelHandle {
  canvas: HTMLCanvasElement;
  setProgram(program: unknown, lines: LumiLine[], renderAtTime?: number): void;
  setLook(look: unknown): Promise<void>;
  renderAt(time: number): void;
  resize(width: number, height: number, resolution: number): void;
  captureFrame(): Promise<string | null>;
  destroy(): void;
}

export interface TideLumiStageEngine {
  compileLumiProgram(input: unknown): unknown;
  getPack(id: "sonnet" | "tempera" | "lumiere" | "hanabi"): { tuning: { defaults: unknown } };
  DEFAULT_KERNEL_TUNING: unknown;
  LumiKernel: {
    create(options: unknown): Promise<LumiKernelHandle>;
  };
}

declare global {
  interface Window {
    TideLumiStageEngine?: TideLumiStageEngine;
  }
}

export {};
