/** Effect layer. M1 is a still wash driven by `--tide-phase`; particles come later. */
export function mountStage(root: HTMLElement): () => void {
  root.replaceChildren();
  const horizon = document.createElement("div");
  horizon.className = "tide-horizon";
  horizon.dataset.extension = "stage-effects";
  root.append(horizon);
  return () => {
    root.replaceChildren();
  };
}
