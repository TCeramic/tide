import { createElement, type IconNode } from "lucide";

/**
 * In-app icons are Lucide, the same set lucide-react renders
 * (Play, Pause, SkipBack, SkipForward, Volume2, Heart, Search, Settings, List, …).
 * Tide's shell is DOM, so this module uses the vanilla `lucide` package
 * (ISC, Copyright (c) 2026 Lucide Icons and Contributors) instead of mounting React.
 * Every glyph shares one stroke width. Sizes are only the three steps below.
 */
export const ICON_STROKE = 1.75;

export const ICON_SIZE = {
  row: 16,
  control: 18,
  play: 22,
} as const;

export const SHELL_ICONS = [
  "Play",
  "Pause",
  "SkipBack",
  "SkipForward",
  "Volume2",
  "Volume1",
  "VolumeX",
  "Heart",
  "Keyboard",
  "Search",
  "Settings",
  "List",
  "ListMusic",
  "Repeat",
  "Repeat1",
  "Shuffle",
  "Compass",
  "MoreHorizontal",
  "ChevronUp",
  "ChevronDown",
  "ChevronLeft",
  "X",
  "Grid3x3",
  "Music2",
  "Radio",
  "LogIn",
  "Waypoints",
  "House",
] as const;

export type { IconNode };

export function setIcon(host: HTMLElement, name: string, node: IconNode, size: number, filled = false): void {
  const key = `${name}:${size}:${filled ? 1 : 0}`;
  if (host.dataset.tideIcon === key) return;
  host.dataset.tideIcon = key;
  const svg = createElement(node, {
    width: size,
    height: size,
    "stroke-width": ICON_STROKE,
    "aria-hidden": "true",
    focusable: "false",
    class: "tide-icon",
  });
  if (filled) {
    svg.setAttribute("fill", "currentColor");
    svg.querySelectorAll("path").forEach((shape) => {
      shape.setAttribute("fill", "currentColor");
    });
  }
  host.replaceChildren(svg);
}

export function iconButton(label: string, name: string, node: IconNode, size: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", label);
  setIcon(button, name, node, size);
  return button;
}

export function prependIcon(host: HTMLElement, name: string, node: IconNode, size: number): void {
  const mark = document.createElement("span");
  mark.className = "section-icon";
  mark.setAttribute("aria-hidden", "true");
  setIcon(mark, name, node, size);
  host.prepend(mark);
}
