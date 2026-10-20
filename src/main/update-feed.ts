export const REPOSITORY = 'https://github.com/TCeramic/tide';
export const CHINA_MIRROR = 'https://gh-proxy.org/https://github.com/TCeramic/tide/releases/download/v{version}/{asset}';
export const RELEASE_API = 'https://api.github.com/repos/TCeramic/tide/releases/latest';
export interface UpdateRelease { version:string; notes:string; page:string; name:string; url:string; size:number; sha256:string; checksumUrl?:string; kind:'setup'|'zip' }
export function newerVersion(candidate:string,current:string):boolean {
  const parse=(value:string)=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  const a=parse(candidate), b=parse(current);if(!a||!b)return false;
  for(let i=1;i<4;i++){if(Number(a[i])!==Number(b[i]))return Number(a[i])>Number(b[i]);}return false;
}
export function releaseFromJson(value:unknown):UpdateRelease {
  const r=value as Record<string,unknown>;
  if(!r||r.draft||r.prerelease||!/^v?\d+\.\d+\.\d+$/.test(String(r.tag_name)))throw new Error('发布信息无效');
  const assets=Array.isArray(r.assets)?r.assets as Record<string,unknown>[]:[];
  const version=String(r.tag_name).replace(/^v/,'');
  const setup=assets.find(a=>a.name===`Tide-Setup-${version}-x64.exe`);
  const asset=setup??assets.find(a=>a.name===`Tide-${version}-win.zip`);
  const valid=(url:unknown)=>typeof url==='string'&&url.startsWith(REPOSITORY+'/releases/download/');
  if(!asset||!valid(asset.browser_download_url)||!Number.isSafeInteger(asset.size)||Number(asset.size)<=0||Number(asset.size)>600*1024*1024)throw new Error('此版本没有可用的 Windows 更新包');
  const checksum=assets.find(a=>a.name==='SHA256SUMS.txt'&&valid(a.browser_download_url));
  const digest=String(asset.digest??'');
  return {version,notes:String(r.body??'暂无更新日志').slice(0,50000),page:REPOSITORY+'/releases/tag/'+String(r.tag_name),name:String(asset.name),url:String(asset.browser_download_url),size:Number(asset.size),sha256:/^sha256:[a-f0-9]{64}$/i.test(digest)?digest.slice(7).toLowerCase():'',kind:setup?'setup':'zip',...(checksum?{checksumUrl:String(checksum.browser_download_url)}:{})};
}
export function localDay(now=new Date()):string{return `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;}
export function validateMirror(template:string):string {
  const value=template.trim();if(!value)return '';
  if(value.length>1000||!value.includes('{asset}'))throw new Error('镜像地址需包含 {asset}，可选 {version}');
  const url=new URL(value.replaceAll('{asset}','Tide.zip').replaceAll('{version}','1.0.0'));
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('镜像必须是无账号密码的 HTTPS 地址');
  return value;
}
export function downloadSources(release:UpdateRelease,mirror:string):string[]{
  const value=validateMirror(mirror);
  return value?[value.replaceAll('{version}',encodeURIComponent(release.version)).replaceAll('{asset}',encodeURIComponent(release.name)),release.url]:[release.url];
}
