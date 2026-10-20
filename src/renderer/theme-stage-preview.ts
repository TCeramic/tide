/** Reuse the live stage pixels during a theme reveal; never start a second GPU renderer. */
export function mirrorThemeStage(frame: string | null | undefined): () => void {
  const reading = document.querySelector<HTMLElement>(".lyrics-reading.has-lyric-stage");
  if (!reading) return () => {};
  const host = reading.querySelector<HTMLElement>(".tide-lyric-stage-host");
  if (!host) {
    reading.classList.remove("has-lyric-stage");
    return () => {};
  }

  const initial = document.createElement("img");
  initial.alt = "";
  initial.setAttribute("aria-hidden", "true");
  Object.assign(initial.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "fill" });
  if (frame) { initial.src = frame; host.append(initial); }
  else reading.classList.remove("has-lyric-stage");

  const mirror = document.createElement("canvas");
  mirror.className = "tide-lyric-stage-preview";
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, { display: "none", width: "100%", height: "100%", pointerEvents: "none" });
  host.append(mirror);
  const context = mirror.getContext("2d", { alpha: true });
  let disposed = false;
  const copyFrame = (event: Event) => {
    if (disposed || !context) return;
    const detail = (event as CustomEvent<{ canvas?: HTMLCanvasElement; pack?: string }>).detail;
    const source = detail?.canvas;
    // Source belongs to the parent realm, so an iframe instanceof check is inappropriate.
    if (!source || source.width < 1 || source.height < 1) return;
    try {
      if (mirror.width !== source.width || mirror.height !== source.height) {
        mirror.width = source.width;
        mirror.height = source.height;
      }
      context.clearRect(0, 0, mirror.width, mirror.height);
      context.drawImage(source, 0, 0);
      mirror.style.display = "block";
      initial.remove();
      host.hidden = false;
      reading.classList.add("has-lyric-stage");
      if (detail.pack) host.dataset.pack = detail.pack;
    } catch {
      // The initial captured frame or the readable DOM lyrics remain available.
    }
  };
  window.addEventListener("tide:lyric-stage-frame", copyFrame);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("tide:lyric-stage-frame", copyFrame);
    window.removeEventListener("pagehide", dispose);
    mirror.width = mirror.height = 0;
  };
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
