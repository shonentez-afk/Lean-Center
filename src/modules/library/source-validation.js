// Pure source validation; no domain event dispatch dependency.
import {MAX_SOP_KEY_MOMENTS} from './sop-limits.js';
import {invariant,isId,canonical,sha256} from '../../core/primitives.js';
export const MAX_CONTENT=30*1024*1024;
export const MIME={sop:'application/vnd.lean.stage43.sop+json',frv:'application/vnd.lean.stage43.frv+json'};
const encoder=new TextEncoder();
export const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
export const string=(x,max=20000)=>typeof x==='string'&&x.length<=max;
export const nonempty=(x,max=500)=>string(x,max)&&x.trim().length>0;
export const date=x=>string(x,10)&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const digest=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
export const types=new Set(['VA','NVA_Necessary','NVA_Waste','WAIT','BREAK','OTHER']);
export const exact=(p,keys)=>invariant(obj(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Неверные поля события LC3');
export const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const safeImage=x=>string(x,MAX_CONTENT)&&/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(x);
export function validateRef(ref){exact(ref,['sha256','size','kind']);invariant(digest(ref.sha256)&&Number.isSafeInteger(ref.size)&&ref.size>0&&ref.size<=MAX_CONTENT&&Object.hasOwn(MIME,ref.kind),'Некорректная ссылка на исходный файл');return ref}
export async function checkContent(ref,text){validateRef(ref);invariant(typeof text==='string'&&text.length<=MAX_CONTENT,'Исходный файл отсутствует или слишком велик');const bytes=encoder.encode(text);invariant(bytes.length===ref.size&&await sha256(bytes)===ref.sha256,'Исходный файл повреждён: '+ref.sha256);return text}
// Historical employee snapshots are part of the hashed source, not authorization.
 // Legacy imports may have plain text without a directory link.
function verifyPeople(source,kind){
 const refs=source.leanCenterPeople;if(refs===undefined)return;
 invariant(Array.isArray(refs)&&refs.length<=1000,'Некорректные ссылки на сотрудников');
 const seen=new Set(),single=new Set();
 for(const x of refs){
  exact(x,['slot','person_id','employee_code','display_name','position','unit']);
  invariant(isId(x.person_id)&&nonempty(x.display_name,500)&&nonempty(x.employee_code,200)&&string(x.position,500)&&string(x.unit,500)&&string(x.slot,100),'Некорректный снимок сотрудника');
  const key=x.slot+':'+x.person_id;invariant(!seen.has(key),'Повтор ссылки сотрудника');seen.add(key);
  if(x.slot!=='sop_observer'){invariant(!single.has(x.slot),'Два сотрудника в одном поле');single.add(x.slot)}
  let name,post=null;
  if(kind==='frv'){invariant(['operator','observer'].includes(x.slot),'Недопустимая роль сотрудника в ФРВ');name=source[x.slot]}
  else if(x.slot==='approver'){name=source.meta.approverName;post=source.meta.approverPost||''}
  else if(x.slot==='sop_observer'){invariant(String(source.frvMeta?.observers||'').split(/\r?\n/).includes(x.display_name),'Снимок наблюдателя не соответствует печатному полю');continue}
  else if(['trainer','trainee'].includes(x.slot))name=source.twi?.[x.slot];
  else{const m=/^(workgroup|agree):(\d+)$/.exec(x.slot);invariant(m,'Недопустимая роль сотрудника в СОП');if(m[1]==='workgroup')name=source.responsibles?.[Number(m[2])];else {const a=source.agreedList?.[Number(m[2])];name=a?.name;post=a?.post||''}}
  invariant(name===x.display_name&&(post===null||post===x.position),'Снимок сотрудника не соответствует печатным полям');
 }
}
export async function inspectSource(text,kind){
 invariant(Object.hasOwn(MIME,kind)&&typeof text==='string'&&text.length<=MAX_CONTENT,'Неверный тип или размер исходного файла');
 const bytes=encoder.encode(text);invariant(bytes.length>0&&bytes.length<=MAX_CONTENT,'Исходный JSON не должен превышать 30 МБ');
 const p=JSON.parse(text);invariant(obj(p),'Ожидался JSON Stage43');
 let projection;
 if(kind==='sop'){
  invariant(p.schemaVersion===2&&obj(p.document)&&Object.hasOwn(p,'constructor')&&obj(p.constructor)&&Array.isArray(p.constructor.steps)&&obj(p.photoAssets)&&p.integrity?.algorithm==='SHA-256'&&digest(p.integrity.sha256),'Ожидалась переносимая копия СОП Stage43 с SHA-256');
  const base={schemaVersion:p.schemaVersion,document:p.document,constructor:p.constructor,photoAssets:p.photoAssets};
  invariant(await sha256(JSON.stringify(base))===p.integrity.sha256,'Контрольная сумма переносимого СОП не совпадает');
  const s=p.constructor,d=p.document,seen=new Set();invariant(obj(s.meta)&&s.steps.length<=1000,'Некорректные шаги СОП');verifyPeople(s,'sop');
  const steps=s.steps.map((st,i)=>{
   invariant(!Array.isArray(st?.keyMoments)||st.keyMoments.length<=MAX_SOP_KEY_MOMENTS,'Шаг '+(i+1)+': допускается не более '+MAX_SOP_KEY_MOMENTS+' ключевых моментов');
   invariant(obj(st)&&Number.isSafeInteger(st.id)&&st.id>0&&!seen.has(st.id)&&string(st.action)&&Array.isArray(st.keyMoments)&&st.keyMoments.every(x=>string(x))&&string(st.reason)&&num(st.durationSeconds)&&typeof st.hasPhoto==='boolean','Некорректный шаг СОП');seen.add(st.id);
   if(st.hasPhoto){const a=p.photoAssets[String(st.id)];invariant(obj(a)&&safeImage(a.original)&&(!a.rendered||safeImage(a.rendered)),'Отсутствует или неподдерживаемое фото шага '+st.id)}
   return {source_id:String(st.id),action:st.action,key_points:st.keyMoments,reason:st.reason,seconds:st.durationSeconds,photo:st.hasPhoto};
  });
  invariant(Object.keys(p.photoAssets).every(k=>steps.some(st=>st.source_id===k&&st.photo)),'Есть фото без соответствующего шага');
  projection={title:String(s.meta.operation||'').slice(0,500),number:String(d.number||s.meta.sopNumber||'').slice(0,200),legacy_id:String(d.id||'').slice(0,200),legacy_version:String(d.version??'').slice(0,50),legacy_status:String(d.status||'').slice(0,80),photos:steps.filter(x=>x.photo).length,twi:!!s.twi?.enabled,steps};
 }else{
  invariant(['FRV-1.2','FRV-1.3'].includes(p.schemaVersion)&&obj(p.study)&&Array.isArray(p.cycles)&&p.cycles.length<=1000,'Ожидалась копия исследования ФРВ FRV-1.2/1.3');
  verifyPeople(p.study,'frv');const seen=new Set(),measurements=[];let complete=0,unmeasured=0,count=0;
  for(const [i,c] of p.cycles.entries()){
   invariant(obj(c)&&Array.isArray(c.observations)&&c.observations.length<=1000,'Некорректный цикл ФРВ');let full=c.observations.length>0;
   const phase=['baseline','improved','unassigned'].includes(c.phase)?c.phase:'unassigned';
   for(const o of c.observations){count++;invariant(count<=5000&&obj(o)&&nonempty(o.id,200)&&!seen.has(o.id)&&string(o.actionRaw)&&(!o.valueType||types.has(o.valueType)),'Некорректное наблюдение ФРВ');seen.add(o.id);
    const v=o.durationSec;invariant(v==null||num(v),'Время наблюдения должно быть числом секунд или null');
    if(v==null||!o.actionRaw.trim()){unmeasured++;full=false;continue}
    if(v===0)full=false;
    measurements.push({source_id:o.id,cycle:i+1,phase,action:o.actionRaw,category:o.valueType||'OTHER',seconds:v});
   }if(full)complete++;
  }
  projection={title:String(p.study.operationId||p.study.processDescription||p.study.studyId||'').slice(0,500),number:String(p.study.studyId||'').slice(0,200),legacy_id:String(p.study.libraryId||'').slice(0,200),legacy_version:String(p.study.version||'').slice(0,50),legacy_status:String(p.study.status||'').slice(0,80),cycles:p.cycles.length,complete,unmeasured,measurements};
 }
 invariant(encoder.encode(canonical(projection)).length<=2*1024*1024,'Слишком большая проекция для одного пакета; разделите источник');
 return {source:{sha256:await sha256(bytes),size:bytes.length,kind},projection}
}
