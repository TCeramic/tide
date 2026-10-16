import assert from "node:assert/strict";
import { it } from "node:test";
import { parseTtml, ttmlTime } from "./ttml";
import { createCommunityLyrics } from "../api/community-lyrics";
import { parseLrc, parseYrc } from "./lyrics";

const sample = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><amll:meta xmlns:amll="http://www.example.test/amll" key="ttmlAuthorGithub" value="tester"/></metadata></head><body><div><p begin="00:01.000" end="00:04.000"><span begin="00:01.000" end="00:02.000">Hello</span> <span begin="00:02.000" end="00:04.000">world</span><span ttm:role="x-translation">你好世界</span><span ttm:role="x-roman">ni hao</span></p></div></body></tt>`;
it("reads TTML word clocks, spaces, alternate languages and author credits", () => {
  const result = parseTtml(sample);
  assert.equal(result.lines[0]?.text, "Hello world");
  assert.equal(result.yrc[0]?.words.map(word => word.text).join(""), "Hello world");
  assert.equal(result.yrc[0]?.words[1]?.timeMs, 2000);
  assert.equal(result.translation[0]?.text, "你好世界");
  assert.deepEqual(result.credits, ["tester"]);
});
it("parses relative offset times without accepting malformed clocks", () => {
  assert.equal(ttmlTime("0.5s", 1000), 1500);
  assert.equal(ttmlTime("01:02.345"), 62345);
  assert.equal(ttmlTime("00:99.000"), null);
  assert.equal(parseTtml(`<tt><body><p begin="1s" dur="2s"><span begin="0s" dur="1s">词</span></p></body></tt>`).yrc[0]?.words[0]?.timeMs, 1000);
});
it("rejects XML entities, DTD and malformed input", () => {
  for (const xml of ["<tt>", '<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///secret">]><tt>&x;</tt>', "<tt>" + " ".repeat(2000001) + "</tt>"]) assert.equal(parseTtml(xml).lines.length, 0);
});
it("community lyrics cache exact IDs and serialize usable LRC/YRC", async () => {
  let calls = 0;
  const load = createCommunityLyrics((async () => { calls++; return new Response(sample); }) as typeof fetch);
  const result = await load("1");
  assert.equal(result?.source, "amll");
  assert.equal(parseLrc(result?.lyric)[0]?.timeMs, 1000);
  assert.equal(parseYrc(result?.yrc)[0]?.text, "Hello world");
  await load("1"); await load("file:///bad"); assert.equal(calls, 1);
});
it("missing community lyrics are cached and do not become request errors", async () => {
  let calls = 0;
  const load = createCommunityLyrics((async () => { calls++; return new Response("", { status: 404 }); }) as typeof fetch);
  assert.equal(await load("2"), null); assert.equal(await load("2"), null); assert.equal(calls, 1);
});
