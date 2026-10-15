export interface StageScene {
  level: number;
  motion: number;
  playing: boolean;
}

/** State bridge. Original Lens / Lattice renderers own the visual stage. */
export function mountStage(root: HTMLElement) {
  return {
    setScene(scene: StageScene) {
      root.style.opacity = String(scene.level);
      root.dataset.playing = String(scene.playing);
    },
    setLattice(on: boolean) { root.dataset.lattice = String(on); },
    destroy() { root.replaceChildren(); },
  };
}
