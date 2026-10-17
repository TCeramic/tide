/** Minimal types for the vanilla Lucide build. The shell is not a React tree. */
declare module "lucide" {
  export type IconNode = ReadonlyArray<readonly [string, Record<string, string>]>;

  export function createElement(
    iconNode: IconNode,
    customAttrs?: Record<string, string | number>,
  ): SVGElement;

  export const ChevronDown: IconNode;
  export const ChevronLeft: IconNode;
  export const ChevronUp: IconNode;
  export const Compass: IconNode;
  export const Grid3x3: IconNode;
  export const Heart: IconNode;
  export const Layers:IconNode;export const Pin:IconNode;export const Lock:IconNode;export const Maximize2:IconNode;
  export const House: IconNode;
  export const Keyboard: IconNode;
  export const List: IconNode;
  export const ListMusic: IconNode;
  export const LogIn: IconNode;
  export const MoreHorizontal: IconNode;
  export const Music2: IconNode;
  export const Pause: IconNode;
  export const Play: IconNode;
  export const Radio: IconNode;
  export const Repeat: IconNode;
  export const Repeat1: IconNode;
  export const Search: IconNode;
  export const Settings: IconNode;
  export const Shuffle: IconNode;
  export const SkipBack: IconNode;
  export const SkipForward: IconNode;
  export const Volume1: IconNode;
  export const Volume2: IconNode;
  export const VolumeX: IconNode;
  export const Waypoints: IconNode;
  export const X: IconNode;
}
