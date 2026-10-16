import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DESK_LYRICS,
  clampDeskOrigin,
  fitDeskBounds,
  deskSettingsFromUnknown,
  deskWindowSize,
} from "./desk-lyrics";

describe("desktop lyrics settings", () => {
  it("defaults to off and clamps appearance", () => {
    assert.equal(deskSettingsFromUnknown(undefined).open, false);
    assert.deepEqual(deskSettingsFromUnknown({}), DEFAULT_DESK_LYRICS);
    const next = deskSettingsFromUnknown({
      open: true,
      locked: true,
      x: 10,
      y: 20,
      fontSize: 4,
      color: "red",
      opacity: 4,
    });
    assert.equal(next.open, true);
    assert.equal(next.locked, true);
    assert.equal(next.fontSize, 18);
    assert.equal(next.color, DEFAULT_DESK_LYRICS.color);
    assert.equal(next.opacity, 1);
    assert.equal(deskSettingsFromUnknown({ x: 10 }).x, null);
    assert.equal(deskSettingsFromUnknown({ opacity: 0.05 }).opacity, 0.2);
    assert.equal(deskSettingsFromUnknown({}).orientation, "horizontal");
    assert.equal(deskSettingsFromUnknown({ orientation: "vertical" }).orientation, "vertical");
    assert.equal(deskSettingsFromUnknown({ orientation: "column" }).orientation, "horizontal");
    assert.equal(deskSettingsFromUnknown({ motionLevel: 4 }).motionLevel, 1);
    assert.equal(deskSettingsFromUnknown({ motionLevel: 0 }).motionLevel, 0.35);
    assert.equal(deskSettingsFromUnknown({ backdrop: 2 }).backdrop, 0.55);
    assert.equal(deskSettingsFromUnknown({ backdrop: -1 }).backdrop, 0);
    const column = deskWindowSize(32, false, "vertical");
    const row = deskWindowSize(32, false, "horizontal");
    assert.ok(column.height > column.width);
    assert.ok(row.width > row.height);
  });

  it("keeps independent sung and unsung colors and a sanitized font", () => {
    const value = deskSettingsFromUnknown({color:"#123456",highlightColor:"#fedcba",fontFamily:"微软雅黑"});
    assert.equal(value.color,"#123456");assert.equal(value.highlightColor,"#fedcba");assert.equal(value.fontFamily,"微软雅黑");
    assert.equal(deskSettingsFromUnknown({highlightColor:"bad"}).highlightColor,DEFAULT_DESK_LYRICS.highlightColor);
    assert.equal(deskSettingsFromUnknown({fontFamily:'";{}'}).fontFamily,DEFAULT_DESK_LYRICS.fontFamily);
  });
  it("keeps a point on the second display and returns a lost point to the first", () => {
    const areas = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1280, height: 800 },
    ];
    const size = deskWindowSize(32);
    assert.deepEqual(clampDeskOrigin({ x: 2000, y: 40 }, areas, size), { x: 2000, y: 40 });
    const lost = clampDeskOrigin({ x: 4000, y: 40 }, areas, size);
    assert.ok(lost.x >= 0 && lost.x < 1920);
    assert.ok(lost.y > 400);
    assert.deepEqual(clampDeskOrigin(null, areas, size).x, lost.x);
  });
});

it("keeps the desktop center when rotating and clamps the whole overlay to its screen",()=>{
 const areas=[{x:-1280,y:0,width:1280,height:720},{x:0,y:0,width:1920,height:1080}];
 const anchor={x:900,y:500};const a=fitDeskBounds(anchor,deskWindowSize(32,true,"horizontal",true),areas),b=fitDeskBounds(anchor,deskWindowSize(32,true,"vertical",true),areas);
 assert.ok(Math.abs(a.x+a.width/2-b.x-b.width/2)<=.5);assert.ok(Math.abs(a.y+a.height/2-b.y-b.height/2)<=.5);
 const edge=fitDeskBounds({x:-1250,y:710},{width:1080,height:640},areas);assert.ok(edge.x>=-1280&&edge.x+edge.width<=0&&edge.y+edge.height<=720);
 assert.equal(deskSettingsFromUnknown({lineMode:"double",pair:true}).lineMode,"double");
 assert.equal(deskSettingsFromUnknown({toggleShortcut:""}).toggleShortcut,"");
 assert.equal(deskSettingsFromUnknown({toggleShortcut:"Ctrl+Alt+F8"}).toggleShortcut,"Ctrl+Alt+F8");
 assert.equal(deskSettingsFromUnknown({toggleShortcut:"garbage"}).toggleShortcut,"Ctrl+Alt+D");
});
