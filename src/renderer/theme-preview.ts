import { restoreThemeScene } from "./theme-scene";
import { mountNativeShell, syncPreviewChoices } from "./native-shell.js";
import { setCustomPalette } from "./generated-theme";
let shell: ReturnType<typeof mountNativeShell> | null = null;
window.addEventListener("message", async event => {
 if (event.source !== parent || event.data?.type !== "tide:preview-init" || shell) return;
 const { token, appearance:a, html, attributes, style, state, scene, font } = event.data;
 for (const [name,value] of Object.entries(attributes)) if(name.startsWith("data-")) document.documentElement.setAttribute(name,String(value));
 document.documentElement.style.cssText=style;if(font){const f=document.createElement("template");f.innerHTML=font;const style=f.content.querySelector("style");if(style)document.head.append(style);}
 const template=document.createElement("template");template.innerHTML=html;
 template.content.querySelectorAll("script,iframe,canvas,.module-exit,.theme-reveal-frame,.native-paper-source,.native-point-hero,.native-set-control,.lx-cursor,.liquid-metal-emblem").forEach(el=>el.remove());
 template.content.querySelectorAll("*").forEach(el=>{for(const attr of Array.from(el.attributes))if(attr.name.startsWith("on"))el.removeAttribute(attr.name);el.classList.remove("lg-surface","webgl-ready","lg-stage");});
 document.body.replaceChildren(template.content);
 const root=document.querySelector<HTMLElement>("#app")!;
 for(const p of Array.from(document.querySelectorAll(".native-popup-layer .corner-panel")))root.append(p);
 document.querySelectorAll(".native-popup-layer").forEach(el=>el.remove());
 document.querySelectorAll(".native-point-range").forEach(el=>{const input=el.querySelector("input");if(input)el.replaceWith(input);else el.remove();});
 const d=document.documentElement.dataset;d.shell=a.shell;d.theme=a.theme;d.colorMode=a.shell==="lattice"?a.latticeMode??"dark":a.lensMode??"light";d.background=a.background;d.emblem=a.emblem??"auto";d.performance=a.performance;d.renderActive="true";d.themePreview="true";
 const values:Record<string,string>={"设计系统":a.shell,"明暗模式":d.colorMode!,"性能":a.performance,"背景":a.background,"TIDE 标识材质":a.emblem??"auto","字体":a.fontPreset};
 syncPreviewChoices(values);
 setCustomPalette(a.customPalette);shell=mountNativeShell(root);shell.sync(a);await shell.restoreVisualState(state);restoreThemeScene(scene);
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));shell.ready();restoreThemeScene(scene);
 parent.postMessage({type:"tide:preview-ready",token},"*");
 window.addEventListener("message",e=>{if(e.source===parent&&e.data?.token===token&&e.data?.type==="tide:preview-live")restoreThemeScene(e.data.scene);if(e.source===parent&&e.data?.token===token&&e.data?.type==="tide:preview-state")parent.postMessage({type:"tide:preview-state",token,state:shell?.visualState()},"*");});
});
