import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'android/assets/web');
await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'android/ui/mobile.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome80',outfile:path.join(out,'mobile.js'),logLevel:'info',minify:true});
for(const file of ['index.html','mobile.css'])await cp(path.join(root,'android/ui',file),path.join(out,file));
await cp(path.join(root,'src/renderer/native-fonts.css'),path.join(out,'native-fonts.css'));
await cp(path.join(root,'src/renderer/vendor/fonts'),path.join(out,'fonts'),{recursive:true});
await mkdir(path.join(out,'assets'),{recursive:true});
await cp(path.join(root,'src/renderer/assets/today-tide.png'),path.join(out,'assets/today-tide.png'));
const systems=path.join(root,'src/renderer/vendor/design-systems');
const styles=[];
for(const [name,files]of Object.entries({lens:['lens/lab/design-system/tokens.css','lens/lab/design-system/components.css'],lattice:['lattice/src/tokens.css','lattice/src/components.css']})){
 const css=await Promise.all(files.map(f=>readFile(path.join(systems,f),'utf8')));styles.push(css[0].replaceAll(':root',`html[data-shell="${name}"]`));styles.push(`@scope (html[data-shell="${name}"]) {\n${css.slice(1).join('\n')}\n}`);
}
await writeFile(path.join(out,'native-systems.css'),styles.join('\n'));
await mkdir(path.join(out,'licenses'),{recursive:true});
for(const [source,name]of [['src/renderer/vendor/design-systems/LICENSE','Lens-Lattice-MIT.txt'],['node_modules/@paper-design/shaders/LICENSE','Paper-Apache-2.0.txt'],['node_modules/@paper-design/shaders/NOTICE','Paper-NOTICE.txt'],['node_modules/three/LICENSE','Three-MIT.txt'],['node_modules/qrcode/license','QRCode-MIT.txt']])await cp(path.join(root,source),path.join(out,'licenses',name));
