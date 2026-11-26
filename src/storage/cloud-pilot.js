// Same-origin demonstration transport. Bearer stays in memory only.
import {invariant,decode,readSnapshot,checkSnapshotManifest,canonical,SCHEMA_VERSION} from '../core/db.js';
import {checkContent,validateRef} from '../modules/library/domain.js';
export class CloudPilotError extends Error{
 constructor(status,message,retryAfterMs=0){super(message);this.status=status;this.retryAfterMs=retryAfterMs}
}
export function cloudPilotTransport(token){
 invariant(/^[0-9a-f]{64}$/i.test(token),'Введите 64-символьный тестовый токен');
 invariant(location.protocol==='https:'||location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname),'Для облачной базы нужен HTTPS');
 async function request(route,{method='GET',body,type='application/json'}={}){
  invariant(route.startsWith('/api/v1/'),'Некорректный маршрут API');
  let res;
  try{res=await fetch(route,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':type})},body,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)})}
  catch{throw new CloudPilotError(0,'Нет связи с сервером. Локальная очередь не удалена')}
  if(!res.ok){let msg='Ошибка сервера ('+res.status+')';try{const x=await res.json();if(typeof x.error==='string')msg=x.error.slice(0,1000)}catch{}const seconds=Number(res.headers.get('retry-after'));throw new CloudPilotError(res.status,msg,Number.isFinite(seconds)&&seconds>0?Math.min(60000,seconds*1000):0)}
  return res
 }
 const json=async(route,opts)=>{const response=await request(route,opts);try{return await response.json()}catch{throw new CloudPilotError(0,'Ответ сервера не получен полностью. Локальная очередь не удалена')}};
 return Object.freeze({
  async session(){const s=await json('/api/v1/session');invariant(s.pilot===true&&/^[a-zA-Z0-9_-]{1,40}$/.test(s.user)&&['editor','viewer'].includes(s.role),'Несовместимый сервер');return s},
  async head(){const m=await json('/api/v1/head');await checkSnapshotManifest(m);invariant(m.schema_version===SCHEMA_VERSION,'Обновите клиент и сервер до единой версии');return m},
  async snapshot(SQL){const s=await json('/api/v1/snapshot');invariant(s.manifest?.schema_version===SCHEMA_VERSION,'Несовместимая схема');return readSnapshot(SQL,s.manifest,decode(s.sqlite_base64))},
  async send(p){return json('/api/v1/packages',{method:'POST',body:canonical(p)})},
  async put(ref,text){validateRef(ref);await checkContent(ref,text);return json('/api/v1/documents/'+ref.sha256+'?kind='+ref.kind,{method:'PUT',body:text,type:'application/json'})},
  async get(ref){validateRef(ref);return checkContent(ref,await (await request('/api/v1/documents/'+ref.sha256)).text())}
 })
}
