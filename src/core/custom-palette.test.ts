import assert from 'node:assert/strict';
import { it } from 'node:test';
import { customPaletteFromUnknown } from './custom-palette';
import { appearancePatchFromArgs } from './command-bus';
import { settingsFromUnknown } from '../main/settings';
const palette={enabled:true,colors:['#123ABC','#456789'],accent:'#abcdef',text:'#ffffff',muted:'#aaaaaa',points:'#eeeeee',panel:'#112233',panelOpacity:.45};
it('validates, persists and disables custom colors without losing the draft',()=>{
 const p=customPaletteFromUnknown(palette)!;assert.deepEqual(p.colors,['#123abc','#456789']);
 assert.deepEqual(appearancePatchFromArgs({customPalette:palette}),{customPalette:p});
 assert.deepEqual(settingsFromUnknown({customPalette:palette}).customPalette,p);
 assert.equal(settingsFromUnknown({customPalette:{...palette,enabled:false}}).customPalette?.enabled,false);
 assert.equal(customPaletteFromUnknown({...palette,panel:'url(invalid)'}),undefined);
 assert.equal(customPaletteFromUnknown({...palette,panelOpacity:NaN}),undefined);
 assert.equal(customPaletteFromUnknown({...palette,panelOpacity:2})?.panelOpacity,.92);
});
