import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { LyricLine, LyricWord, YrcLine } from "../shared/contract";

export interface ParsedTtml { lines: LyricLine[]; translation: LyricLine[]; romaji: LyricLine[]; yrc: YrcLine[]; credits: string[]; }
type Node = Record<string, unknown>;
const array = (value: unknown): Node[] => Array.isArray(value) ? value as Node[] : [];
const attrs = (node: Node): Record<string, string> => (node[":@"] ?? {}) as Record<string, string>;
const local = (name: string): string => name.split(":").at(-1) ?? name;
const element = (node: Node): string => Object.keys(node).find(key => key !== ":@" && key !== "#text") ?? "";
const textOf = (nodes: Node[]): string => nodes.map(node => typeof node["#text"] === "string" ? node["#text"] : textOf(array(node[element(node)]))).join("");

export function ttmlTime(value: string | undefined, parentMs = 0): number | null {
  if (!value) return null;
  const clock = /^(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (clock) {
    if (Number(clock[2]) >= 60 || Number(clock[3]) >= 60) return null;
    return Math.round((Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000 + Number(`0.${clock[4] ?? 0}`) * 1000);
  }
  const offset = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!offset) return null;
  return parentMs + Math.round(Number(offset[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[offset[2]!] ?? 1));
}

/** AMLL's public TTML profile: clock/offset times, mixed text, timed words and alternate languages. */
export function parseTtml(source: string): ParsedTtml {
  const result: ParsedTtml = { lines: [], translation: [], romaji: [], yrc: [], credits: [] };
  if (!source || source.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) return result;
  const nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false }).parse(source) as Node[];
  let paragraphs = 0;
  const walk = (items: Node[], parentMs: number) => {
    for (const node of items) {
      const tag = element(node); if (!tag) continue;
      const a = attrs(node), children = array(node[tag]);
      if (local(tag) === "meta" && /author|creator/i.test(a.key ?? "") && a.value) {
        if (result.credits.length < 20) result.credits.push(a.value.slice(0, 120));
      }
      const begin = ttmlTime(a.begin, parentMs) ?? parentMs;
      if (local(tag) !== "p") { walk(children, begin); continue; }
      if (++paragraphs > 1000) return;
      const end = ttmlTime(a.end, parentMs) ?? ttmlTime(a.dur, begin) ?? begin + 4000;
      if (begin < 0 || end <= begin || end > 86_400_000) continue;
      const words: LyricWord[] = [], main: string[] = [];
      const readSpans = (parts: Node[], inheritedBegin: number, inheritedEnd: number) => {
        for (const part of parts) {
          if (typeof part["#text"] === "string") {
            const text = part["#text"];
            if (!text.trim() && /[\r\n]/.test(text)) continue;
            main.push(text);
            if (!text.trim() && words.length) words[words.length - 1]!.text += text;
            continue;
          }
          const name = element(part), attributes = attrs(part), nested = array(part[name]);
          const role = attributes["ttm:role"] ?? attributes.role ?? "";
          if (role.includes("translation") || role.includes("roman")) {
            const text = textOf(nested).trim().slice(0, 400);
            if (text) (role.includes("translation") ? result.translation : result.romaji).push({ timeMs: begin, text });
            continue;
          }
          const start = ttmlTime(attributes.begin, inheritedBegin) ?? inheritedBegin;
          const finish = ttmlTime(attributes.end, inheritedBegin) ?? ttmlTime(attributes.dur, start) ?? inheritedEnd;
          const hasNestedElement = nested.some(item => Boolean(element(item)));
          if (attributes.begin && !hasNestedElement) {
            const text = textOf(nested);
            main.push(text);
            if (text.trim() && finish > start && start < end && finish > begin && words.length < 1000) words.push({ text: text.slice(0, 400), timeMs: Math.max(begin, start), durationMs: Math.max(1, Math.min(end, finish) - Math.max(begin, start)) });
          } else readSpans(nested, start, finish);
        }
      };
      readSpans(children, begin, end);
      const text = main.join("").trim().slice(0, 400);
      if (!text) continue;
      words.sort((a, b) => a.timeMs - b.timeMs);
      result.lines.push({ timeMs: begin, text });
      result.yrc.push({ timeMs: begin, durationMs: end - begin, text, words });
    }
  };
  walk(nodes, 0);
  for (const rows of [result.lines, result.yrc, result.translation, result.romaji]) rows.sort((a, b) => a.timeMs - b.timeMs);
  result.credits = [...new Set(result.credits)];
  return result;
}
