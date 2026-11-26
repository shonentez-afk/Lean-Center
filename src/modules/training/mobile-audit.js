// Standalone offline form with exact Lean-Center identifiers and immutable method snapshot.
import {rows,one,invariant,isId,canonical,sha256,meta} from '../../core/db.js';
import {validDate} from '../library/sop-review.js';
const system='LEAN_CENTER_MOBILE_L1';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(p,k)=>invariant(obj(p)&&Object.keys(p).length===k.length&&k.every(x=>Object.hasOwn(p,x)),'Некорректные поля мобильного аудита');
const text=(x,n)=>typeof x==='string'&&x.length<=n;
export function mobileRecord(x){
 exact(x,['id','database_id','assignment_id','revision_id','mentor_id','trainee_id','auditor_id','method_id','method_json','observed_on','responses','feedback']);
 invariant(['id','database_id','assignment_id','revision_id','mentor_id','trainee_id','auditor_id','method_id'].every(k=>isId(x[k]))&&text(x.method_json,128000)&&validDate(x.observed_on)&&Array.isArray(x.responses)&&x.responses.length>0&&x.responses.length<=100&&text(x.feedback,500)&&x.feedback.trim(),'Некорректный мобильный аудит');
 for(const r of x.responses){exact(r,['criterion_id','value','note']);invariant(text(r.criterion_id,100)&&[0,1,'not_observed','not_applicable'].includes(r.value)&&text(r.note,2000)&&(!['not_observed','not_applicable'].includes(r.value)||r.note.trim()),'Заполните ответы и основания')}
 return x
}
export function mobileMapping(db,id){return one(db,'SELECT * FROM legacy_mapping WHERE source_system=? AND source_entity=? AND source_id=?',[system,'audit',id])}
export function mobileContext(db,record){
 const a=one(db,'SELECT * FROM training_assignment WHERE id=? AND source_sha256 IS NOT NULL',[record.assignment_id]),m=one(db,"SELECT v.* FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE v.id=? AND c.code='TWI_L1_RC1' AND v.state IN('active','retired') AND v.legacy_context_json IS NULL",[record.method_id]);
 invariant(record.database_id===meta(db,'database_id')&&a&&a.state!=='cancelled'&&a.approval_json&&a.sop_revision_id===record.revision_id&&a.mentor_id===record.mentor_id&&a.trainee_id===record.trainee_id&&m&&m.methodology_json===record.method_json,'Другая база, изменённое назначение или несовпадающая методика');
 return {assignment:a,method:m}
}
export async function mobilePlan(db,raw){
 invariant(raw?.type==='lean-l1-mobile-v1'&&raw.schemaVersion===1&&Array.isArray(raw.audits)&&raw.audits.length<=100,'Ожидается мобильный пакет Lean-Center до 100 аудитов');
 const seen=new Set(),items=[];for(const r of raw.audits){try{const record=mobileRecord(r);invariant(!seen.has(record.id),'Повтор ID в пакете');seen.add(record.id);const hash=await sha256(canonical(record)),existing=mobileMapping(db,record.id),context=mobileContext(db,record);const facts=rows(db,"SELECT * FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL AND substr(held_at,1,10)<=? ORDER BY held_at DESC,id",[record.assignment_id,record.observed_on]);items.push({record,hash,existing,context,facts,status:existing?(existing.source_hash===hash?'duplicate':'conflict'):facts.length?'ready':'waiting'})}catch(e){items.push({status:'invalid',error:e.message})}}return items
}
export function verifyMobileContext(db,p,a){
 const r=mobileRecord(p.mobile_record);const c=mobileContext(db,r);
 invariant(c.assignment.id===a.id&&p.method_id===r.method_id&&p.auditor_id===r.auditor_id&&p.observed_on===r.observed_on&&canonical(p.responses)===canonical(r.responses)&&p.feedback===r.feedback&&/^[0-9a-f]{64}$/.test(p.mobile_hash)&&!mobileMapping(db,r.id),'Мобильная запись уже импортирована или изменена');
 return c.method
}
export async function verifyMobileEvent(e){if(e.entity_type==='audit_session'&&e.payload?.command==='mobile_lc5')invariant(await sha256(canonical(mobileRecord(e.payload.mobile_record)))===e.payload.mobile_hash,'Изменилось содержимое мобильной записи')}
export function recordMobileMapping(db,e){const p=e.payload;db.run('INSERT INTO legacy_mapping(source_system,source_entity,source_id,target_entity,target_id,source_hash) VALUES(?,?,?,?,?,?)',[system,'audit',p.mobile_record.id,'audit_session',e.entity_id,p.mobile_hash])}
export function mobileAuditHtml(config){
 const data=JSON.stringify(config).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lean-Center · Мобильный аудит L1</title><style>body{font:16px Arial,sans-serif;max-width:760px;margin:auto;padding:16px;background:#f5f6f8;color:#182437}h1{font-size:23px}fieldset{background:white;border:1px solid #ccd3dd;border-radius:9px;margin:12px 0;padding:12px}label{display:block;margin:8px 0}select,input,textarea,button{font:inherit;padding:10px;max-width:100%;box-sizing:border-box}select,textarea{width:100%}button{margin:6px 3px;background:#b7222b;color:white;border:0;border-radius:7px}button.secondary{background:#44546b}small{display:block;color:#59667a}#status{white-space:pre-wrap}</style><body><h1>Мобильный аудит первого уровня</h1><p id="info"></p><label>Дата наблюдения <input id="date" type="date"></label><div id="questions"></div><label>Обратная связь<textarea id="feedback" maxlength="500" rows="4"></textarea></label><p id="status" role="status"></p><button id="save">Сохранить аудит</button><button id="export" class="secondary">Скачать пакет JSON</button><button id="clear" class="secondary">Новый бланк</button><small>Форма работает без интернета. Храните файл и выгруженные пакеты в защищённой папке. После передачи сохраните JSON до подтверждения импорта. Локальное хранение браузера может быть недоступно или очищено.</small><script>('+mobileRuntime.toString()+')('+data+');<\/script></body></html>'
}
function mobileRuntime(config){
 const $=id=>document.getElementById(id),node=(tag,s)=>{const n=document.createElement(tag);if(s!==undefined)n.textContent=s;return n},key='lean-l1-mobile:'+config.database_id+':'+config.assignment_id+':'+config.method_id+':'+config.auditor_id;
 let queue=[],storage=true;try{const x=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(x))queue=x}catch{storage=false}
 function status(s){$('status').textContent=s+' · В очереди: '+queue.length+(storage?'':' · Память браузера недоступна; скачайте JSON перед закрытием.')}
 function persist(){try{localStorage.setItem(key,JSON.stringify(queue))}catch{storage=false}}
 const date=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};$('date').value=date();
 $('info').textContent=config.label;
 const controls=config.criteria.map(q=>{const fs=node('fieldset'),legend=node('legend',q.position+'. '+q.question),sec=node('small',q.section_code),select=node('select'),note=node('textarea'),details=node('details'),exception=node('select');for(const [v,l] of [['','— Не заполнено —'],['1','1 — Да'],['0','0 — Нет']]){const o=node('option',l);o.value=v;select.append(o)}for(const [v,l] of [['','— Причина отсутствия оценки —'],['not_observed','Не наблюдалось'],['not_applicable','Не применимо']]){const o=node('option',l);o.value=v;exception.append(o)}details.append(node('summary','Не удалось оценить'),exception);select.onchange=()=>{exception.value='';details.open=false};exception.onchange=()=>{if(exception.value)select.value=''};note.placeholder='Комментарий / основание';note.maxLength=2000;note.rows=2;fs.append(legend,sec,select,details,note);$('questions').append(fs);return {q,select,note,exception,details}});
 function clear(){$('date').value=date();$('feedback').value='';for(const c of controls){c.select.value='';c.exception.value='';c.details.open=false;c.note.value=''}}
 function uuid(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const a=new Uint8Array(16);crypto.getRandomValues(a);a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
 $('save').onclick=()=>{try{const responses=controls.map(c=>({criterion_id:c.q.id,value:c.exception.value||(c.select.value==='0'?0:c.select.value==='1'?1:c.select.value),note:c.note.value}));if(!$('date').value||!$('feedback').value.trim()||responses.some(r=>r.value===''||(['not_observed','not_applicable'].includes(r.value)&&!r.note.trim())))throw Error('Заполните все критерии, основания и обратную связь.');if(queue.length>=100)throw Error('Очередь достигла 100 записей. Скачайте пакет.');const {criteria,label,...context}=config,rec={id:uuid(),...context,observed_on:$('date').value,responses,feedback:$('feedback').value};if(queue.some(r=>r.observed_on===rec.observed_on&&JSON.stringify(r.responses)===JSON.stringify(rec.responses)&&r.feedback===rec.feedback))throw Error('Такой аудит уже есть в очереди.');queue.push(rec);persist();clear();status('Аудит сохранён. Скачайте JSON.')}catch(e){status(e.message)}};
 $('export').onclick=()=>{if(!queue.length){status('Нет сохранённых записей');return}const url=URL.createObjectURL(new Blob([JSON.stringify({type:'lean-l1-mobile-v1',schemaVersion:1,audits:queue},null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='LeanCenter-L1-'+date()+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);status('Файл сформирован. Очередь сохранена для повторной передачи.')};
 $('clear').onclick=()=>{if(confirm('Очистить только текущий незаписанный бланк?'))clear()};status('Готово')
}
