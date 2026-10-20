import assert from "node:assert/strict";
import { it } from "node:test";
import { showHome, openNowPlaying, toggleNowPlaying, shellView, shellPage, setShellPage, onShellView } from "./view";

it("cover navigation restores the mounted page's scroll rather than invoking homepage navigation", () => {
  const previous = globalThis.document;
  const sheet = { scrollTop:320, scrollLeft:0, isConnected:true };
  Object.defineProperty(globalThis,"document",{ configurable:true,value:{ documentElement:{dataset:{}},querySelectorAll:()=>[sheet] } });
  showHome();
  const stop = onShellView(view => { if (view === "playing") sheet.scrollTop = 0; });
  try {
    toggleNowPlaying(); assert.equal(shellView(),"playing");
    openNowPlaying(); // Re-opening cannot replace the saved position with hidden-page zeros.
    toggleNowPlaying(); assert.equal(shellView(),"home"); assert.equal(sheet.scrollTop,320);
  } finally {
    stop(); showHome();
    if (previous) Object.defineProperty(globalThis,"document",{configurable:true,value:previous});
    else Reflect.deleteProperty(globalThis,"document");
  }
});

it("keeps the active content route separate from the now-playing shell view", () => {
  const previous = globalThis.document;
  const dataset: Record<string, string> = {};
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset }, querySelectorAll: () => [] },
  });
  try {
    setShellPage("library");
    openNowPlaying();
    assert.equal(shellView(), "playing");
    assert.equal(shellPage(), "library");
    assert.equal(dataset.view, "playing");
    assert.equal(dataset.page, "library");
    toggleNowPlaying();
    assert.equal(shellView(), "home");
    assert.equal(shellPage(), "library");
    assert.equal(dataset.page, "library");
  } finally {
    showHome();
    if (previous) Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
    else Reflect.deleteProperty(globalThis, "document");
  }
});
