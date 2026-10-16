import { prepare, layout, measureNaturalWidth, clearCache, type PreparedText } from "@chenglou/pretext";
const cache = new Map<string, PreparedText>();
if (typeof document !== "undefined") document.fonts.addEventListener("loadingdone", () => { cache.clear(); clearCache(); });
export function measureTextLayout(text: string, font: string, width: number, lineHeight: number) {
  const key = `${font}\u0000${text}`;
  let prepared = cache.get(key);
  if (!prepared) { prepared = prepare(text, font); cache.set(key, prepared); while (cache.size > 256) cache.delete(cache.keys().next().value!); }
  return { ...layout(prepared, Math.max(1, width), lineHeight), width: measureNaturalWidth(prepared) };
}
