const failed = new Set<string>();

/** Real art when the URL loads. Otherwise a tide mark, never the title's first glyph. */
export function paintCover(host: HTMLElement, url: string | undefined): void {
  host.classList.add("cover-slot");
  host.replaceChildren();
  if (!url || !/^https?:\/\//.test(url) || failed.has(url)) {
    host.append(mark());
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.src = url;
  image.addEventListener("error", () => {
    failed.add(url);
    if (host.contains(image)) host.replaceChildren(mark());
  });
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
