import { CHINA_MIRROR } from "../../main/update-feed";
import { TIDE_VERSION } from '../../shared/contract';

export function mountAbout(){
  const element=document.createElement('section');element.className='about-page';
  const mark=document.createElement('img');mark.src='icon.png';mark.alt='Tide';mark.width=72;mark.height=72;
  const title=document.createElement('h3');title.textContent='潮汐 Tide';
  const version=document.createElement('p');version.className='library-note';version.textContent='版本 '+TIDE_VERSION;
  const repository=document.createElement('button');repository.type='button';repository.className='text-button';repository.textContent='GitHub 仓库';repository.onclick=()=>void window.tide.openProject();
  const actions=document.createElement('div');actions.className='settings-actions';
  const check=document.createElement('button');check.type='button';check.className='text-button';check.textContent='检查更新';
  const download=document.createElement('button');download.type='button';download.className='text-button';download.textContent='下载更新';download.hidden=true;
  const status=document.createElement('p');status.className='library-note';status.setAttribute('role','status');status.textContent='启动时自动检查，下载前会询问。';
  const history=document.createElement('details');history.className='update-history';
  const summary=document.createElement('summary');summary.textContent='更新日志';
  const notes=document.createElement('div');notes.className='release-notes';notes.textContent='检查更新后查看最新版本日志。';history.append(summary,notes);
  const mirror=document.createElement('details');const label=document.createElement('summary');label.textContent='更新下载源';
  const source=document.createElement('select');source.setAttribute('aria-label','更新下载源');for(const [value,text]of [['auto','自动（加速优先）'],['official','GitHub 官方'],['custom','自定义镜像']]){const option=document.createElement('option');option.value=value!;option.textContent=text!;source.append(option);}
  const input=document.createElement('input');input.className='key-input';input.type='url';input.placeholder='留空使用 GitHub';input.setAttribute('aria-label','更新镜像地址');
  const help=document.createElement('p');help.className='library-note';help.textContent='加速使用第三方 GH-Proxy，仅下载公开安装包；失败回退官方源，文件通过 SHA-256 校验。自定义地址支持 {version}、{asset}。';
  const save=document.createElement('button');save.type='button';save.className='text-button';save.textContent='保存下载源';
  save.onclick=async()=>{const result=await window.tide.setUpdateMirror(source.value==='auto'?CHINA_MIRROR:source.value==='official'?'':input.value);status.textContent=result.ok?(source.value==='official'?'已使用 GitHub 官方源':'已优先使用镜像源'):result.message??'保存失败';};
  source.onchange=()=>{input.hidden=source.value!=='custom';};input.hidden=true;mirror.append(label,source,input,help,save);
  check.onclick=async()=>{check.disabled=true;check.textContent='检查中…';try{const result=await window.tide.checkUpdate();status.textContent=!result.ok?result.message??'检查失败':result.available?'发现新版本 '+result.version:'当前已是最新版本';download.hidden=!result.ok||!result.available;if(result.ok){notes.textContent=result.notes??'暂无更新日志';summary.textContent='更新日志 · '+result.version;}}catch{status.textContent='检查失败，请稍后重试';}finally{check.disabled=false;check.textContent='检查更新';}};
  history.addEventListener('toggle',()=>{if(history.open&&notes.textContent==='检查更新后查看最新版本日志。')check.click();});
  download.onclick=async()=>{download.disabled=true;try{const result=await window.tide.downloadUpdate();status.textContent=result.message;}finally{download.disabled=false;}};
  const stop=window.tide.onUpdateProgress(percent=>{status.textContent='下载更新 '+percent+'%';});
  void window.tide.getUpdateInfo().then(info=>{input.value=info.mirror;source.value=info.mirror===CHINA_MIRROR?'auto':info.mirror?'custom':'official';input.hidden=source.value!=='custom';}).catch(()=>{});
  const credits=document.createElement('p');credits.className='library-note';credits.textContent='Tide · GPL-3.0。非官方个人音乐客户端。透镜 / 点阵：DayDreamInAReverie · MIT。第三方版权及许可随软件提供。';
  actions.append(check,download);element.append(mark,title,version,repository,actions,status,history,mirror,credits);
  return {element,destroy:stop};
}
