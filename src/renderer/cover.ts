import { normalizeArtworkUrl } from "../core/artwork";

const failed = new Map<string, number>();

/** Real art when the URL loads. Otherwise a tide mark, never the title's first glyph. */
export function paintCover(host: HTMLElement, url: string | undefined, options: { lazy?: boolean } = {}): void {
  host.classList.add("cover-slot");
  host.replaceChildren();
  const normalized = normalizeArtworkUrl(url);
  if (!normalized || (failed.get(normalized) ?? 0) > Date.now()) {
    host.append(mark());
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.loading = options.lazy ? "lazy" : "eager";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("load", () => failed.delete(normalized));
  image.addEventListener("error", () => {
    failed.set(normalized, Date.now() + 30_000);
    while (failed.size > 200) failed.delete(failed.keys().next().value!);
    if (host.contains(image)) host.replaceChildren(mark());
  });
  image.src = normalized;
  host.append(image);
}

function mark(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  const wave = document.createElementNS("http://www.w3.org/2000/svg", "path");
  wave.setAttribute("d", "M6 30c4-8 8-8 12 0s8 8 12 0 8-8 12 0");
  wave.setAttribute("fill", "none");
  wave.setAttribute("stroke", "currentColor");
  wave.setAttribute("stroke-width", "2.2");
  wave.setAttribute("stroke-linecap", "round");
  svg.append(wave);
  return svg;
}
