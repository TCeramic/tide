import assert from "node:assert/strict";
import { it } from "node:test";
import { showHome, openNowPlaying, toggleNowPlaying, shellView, onShellView } from "./view";

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
