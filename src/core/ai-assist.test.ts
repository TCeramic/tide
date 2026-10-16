import assert from "node:assert/strict";
import { it } from "node:test";
import { aiPrompt, parseAiResult, segmentLyricLines } from "./ai-assist";
import { themeFromPixels } from "./generated-theme";
import { createAiAssistant } from "../main/ai-assist";

it("local palettes work without model credentials and use actual cover pixels", () => {
  assert.deepEqual(themeFromPixels([], "曲目"), themeFromPixels([], "曲目"));
  const theme = themeFromPixels([200, 40, 80, 255, 200, 40, 80, 255], "曲目");
  assert.equal(theme.source, "cover"); assert.equal(theme.accent, "#c82850");
});
it("AI imports reject changed lyric text and executable CSS values", () => {
  const input = { task: "segment" as const, title: "曲", lines: ["Hello world"] };
  assert.match(aiPrompt(input), /Never generate or alter timestamps/);
  assert.equal(parseAiResult('{"segments":[["Hello ","world"]]}', input).task, "segment");
  assert.throws(() => parseAiResult('{"segments":[["Hello","world"]]}', input), /改变/);
  assert.throws(() => parseAiResult('{"colors":["url(secret)","#ffffff"],"accent":"#ffffff"}', { ...input, task: "theme" }), /配色/);
});
it("AI segmentation keeps measured times and marks synthetic timing", () => {
  const line = { timeMs: 1000, text: "你好" };
  const timed = [{ ...line, durationMs: 2000, words: [{ text: "你", timeMs: 1000, durationMs: 500 }, { text: "好", timeMs: 1500, durationMs: 1500 }] }];
  assert.equal(segmentLyricLines([line], [["你", "好"]], timed)[0]?.words[1]?.timeMs, 1500);
  assert.equal(segmentLyricLines([line], [["你", "好"]], [])[0]?.estimated, true);
});
it("unconfigured AI does not call the network or expose credential state", async () => {
  let calls = 0;
  const ai = createAiAssistant({}, (async () => { calls++; throw new Error("unused"); }) as typeof fetch);
  assert.equal(ai.status().configured, false);
  assert.equal((await ai.generate({})).ok, false); assert.equal(calls, 0);
});
it("model adapter accepts validated structured output from a local test transport", async () => {
  let request: RequestInit | undefined;
  const ai = createAiAssistant({ TIDE_AI_ENDPOINT: "http://127.0.0.1:9999/v1", TIDE_AI_MODEL: "fixture" }, (async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"测试","colors":["#112233","#445566"],"accent":"#aabbcc"}' } }] }));
  }) as typeof fetch);
  assert.equal(ai.status().configured, true);
  assert.equal((await ai.generate({ task: "theme", title: "曲目", lines: [] })).ok, true);
  assert.equal(JSON.parse(request!.body as string).model, "fixture");
});
it("model failures do not echo keys or upstream response bodies", async () => {
  const ai = createAiAssistant({ TIDE_AI_ENDPOINT: "https://example.test/v1", TIDE_AI_MODEL: "fixture", TIDE_AI_KEY: "private-test-value" }, (async () => { throw new Error("private-test-value"); }) as typeof fetch);
  assert.equal(JSON.stringify(await ai.generate({ task: "theme", title: "", lines: [] })).includes("private-test-value"), false);
});
