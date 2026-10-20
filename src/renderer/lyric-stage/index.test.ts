import assert from "node:assert/strict";
import test from "node:test";
import type { YrcLine } from "../../shared/contract";
import { mountLyricStage, type LyricStageState } from "./index";
import type { LumiKernelHandle, TideLumiStageEngine } from "./engine";

interface Counters {
  compile: number;
  create: number;
  setLook: number;
  setProgram: number;
  render: number;
  destroy: number;
  renderTimes: number[];
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = { add: (...names: string[]) => names.forEach(name => this.classes.add(name)) };
  hidden = false;
  className = "";
  parent: FakeElement | null = null;

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  prepend(child: FakeElement): void { child.parent = this; this.children.unshift(child); }
  appendChild(child: FakeElement): FakeElement { child.parent = this; this.children.push(child); return child; }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  getBoundingClientRect() { return { width: 640, height: 360 }; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeKernel(counters: Counters): LumiKernelHandle {
  const canvas = new FakeElement() as unknown as HTMLCanvasElement;
  const kernel: LumiKernelHandle = {
    canvas,
    setProgram: () => { counters.setProgram += 1; },
    setLook: async () => { counters.setLook += 1; },
    renderAt: time => { counters.render += 1; counters.renderTimes.push(time); },
    resize: () => undefined,
    captureFrame: async () => "data:image/png;base64,fixture",
    destroy: () => { counters.destroy += 1; (canvas as unknown as FakeElement).remove(); },
  };
  return kernel;
}

function setup(createKernel?: (index: number) => Promise<LumiKernelHandle>) {
  const counters: Counters = { compile: 0, create: 0, setLook: 0, setProgram: 0, render: 0, destroy: 0, renderTimes: [] };
  const engine: TideLumiStageEngine = {
    compileLumiProgram: () => { counters.compile += 1; return { program: counters.compile }; },
    getPack: () => ({ tuning: { defaults: {} } }),
    DEFAULT_KERNEL_TUNING: {},
    LumiKernel: {
      create: async () => {
        const index = ++counters.create;
        return createKernel ? createKernel(index) : makeKernel(counters);
      },
    },
  };
  const eventTarget = new EventTarget() as EventTarget & { TideLumiStageEngine: TideLumiStageEngine; innerWidth: number; innerHeight: number; devicePixelRatio: number };
  Object.assign(eventTarget, { TideLumiStageEngine: engine, innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 });
  Object.assign(globalThis, {
    window: eventTarget,
    document: { createElement: () => new FakeElement(), head: new FakeElement() },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  return { counters, host: new FakeElement() as unknown as HTMLElement };
}

function state(overrides: Partial<LyricStageState> = {}): LyricStageState {
  const yrc: YrcLine[] = [{
    timeMs: 0,
    durationMs: 12_000,
    text: "A long lyric for deterministic seek testing",
    words: [{ text: "A long lyric for deterministic seek testing", timeMs: 0, durationMs: 12_000 }],
  }];
  return {
    trackId: "track-a",
    pack: "sonnet",
    yrc,
    original: [],
    translation: [],
    romanization: [],
    durationMs: 20_000,
    positionMs: 0,
    playing: true,
    metadata: { title: "Song A", artist: "Tide" },
    theme: { backgroundColor: "#111923", primaryColor: "#ffffff", accentColor: "#83ddf1", secondaryColor: "#a8b8c8", fontStyle: "serif" },
    coverBlob: null,
    coverColors: ["#123456"],
    performance: "vivid",
    ...overrides,
  };
}

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 45)); };

test("stage caches its compiled program/look across position updates and does not redraw paused time", async () => {
  const { counters, host } = setup();
  const initial = state();
  const stage = mountLyricStage(host as unknown as HTMLElement, initial);
  await stage.ready;

  for (let index = 1; index <= 100; index += 1) {
    stage.update({ ...initial, positionMs: index * 100, playing: true });
  }
  await flush();
  assert.equal(counters.compile, 1);
  assert.equal(counters.setLook, 0);

  const paused = { ...initial, positionMs: 10_000, playing: false };
  stage.update(paused);
  await flush();
  const pausedDraws = counters.render;
  for (let index = 0; index < 10; index += 1) stage.update({ ...paused });
  await flush();
  assert.equal(counters.render, pausedDraws);
  stage.destroy();
  assert.equal(counters.destroy, 1);
});

test("stale async create is destroyed before its canvas can be attached", async () => {
  const pending: ReturnType<typeof deferred<LumiKernelHandle>>[] = [];
  let counters!: Counters;
  const { host, counters: currentCounters } = setup(() => {
    const item = deferred<LumiKernelHandle>();
    pending.push(item);
    return item.promise;
  });
  counters = currentCounters;
  const stage = mountLyricStage(host as unknown as HTMLElement, state());
  let readySettled = false;
  void stage.ready.then(() => { readySettled = true; });
  await flush();
  assert.equal(counters.create, 1);

  const next = state({ trackId: "track-b", metadata: { title: "Song B", artist: "Tide" } });
  stage.update(next);
  await flush();
  assert.equal(counters.create, 2);

  const stale = makeKernel(counters);
  const current = makeKernel(counters);
  pending[0].resolve(stale);
  await flush();
  assert.equal(readySettled, false, "ready must wait for the newest scene's first frame");
  assert.equal((host as unknown as FakeElement).children[0].children.length, 0);

  pending[1].resolve(current);
  await stage.ready;
  await flush();
  assert.equal(readySettled, true);

  const stageHost = (host as unknown as FakeElement).children[0];
  assert.equal(counters.destroy, 1);
  assert.equal(stageHost.children.length, 1);
  assert.equal(stageHost.children[0], current.canvas as unknown as FakeElement);
  assert.ok(counters.renderTimes.every(time => time === 0));
  stage.destroy();
  assert.equal(counters.destroy, 2);
});

test("a create rejection after destroy is ignored by the destroyed handle", async () => {
  const pending = deferred<LumiKernelHandle>();
  const { host } = setup(() => pending.promise);
  let callbackErrors = 0;
  let diagnosticErrors = 0;
  const errorListener = () => { diagnosticErrors += 1; };
  (window as unknown as EventTarget).addEventListener("tide:lyric-stage-error", errorListener);
  const stage = mountLyricStage(host as unknown as HTMLElement, state(), () => { callbackErrors += 1; });
  await flush();
  stage.destroy();
  await stage.ready;
  pending.reject(new Error("late create failure"));
  await flush();
  (window as unknown as EventTarget).removeEventListener("tide:lyric-stage-error", errorListener);
  assert.equal(callbackErrors, 0);
  assert.equal(diagnosticErrors, 0);
});

test("disabling the stage releases its kernel and re-enabling creates a fresh one", async () => {
  const { counters, host } = setup();
  const initial = state();
  const stage = mountLyricStage(host as unknown as HTMLElement, initial);
  await stage.ready;
  stage.setVisible(false);
  assert.equal(counters.destroy, 1);
  stage.setVisible(true);
  await flush();
  assert.equal(counters.create, 2);
  stage.update({ ...initial, pack: null });
  await flush();
  assert.equal(counters.destroy, 2);
  stage.destroy();
  assert.equal(counters.destroy, 2);
});
