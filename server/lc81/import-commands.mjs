// Bounded spreadsheet import. Preview is performed on an isolated copy, then
// the identical typed directory commands are revalidated in one transaction.
// Never import access grants, historical assignments or arbitrary event packages.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {one,rows,definitions,list,identityKey,foldKey,recordPayload,meta,canonical,parseLevels} from '../../src/core/db.js';
import {autoMap,sheetHeaders,sheetRows,loadWorkbook,cellText,fieldLabel} from '../../src/modules/master-data/import-xlsx.js';
import {readZip,zipStored} from '../../src/modules/training/local-docx.js';
import {DIRECTORIES} from './access-contract.mjs';
import {applyDirectoryCommand,directorySchema} from './directory-commands.mjs';
import {excelJS} from './form-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const MAX_FILE=2*1024*1024,MAX_ROWS=200,MAX_EXPANDED=12*1024*1024;
const secret=randomBytes(32);
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const dirTypes=['org_unit','profession','position','work_shift','person','equipment','workplace','operation','rating_scale'];
const extra=['unit_id','profession_id','position_id','shift_id'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const specs=type=>directorySchema(type).createFields;
const label=(type,k)=>type==='person'&&extra.includes(k)?fieldLabel('person_assignment',k):fieldLabel(type,k);
export function importTypes(a){
 return dirTypes.filter(t=>a.permissions.includes(DIRECTORIES[t].read)&&[DIRECTORIES[t].create,DIRECTORIES[t].update].some(k=>k&&a.permissions.includes(k))).map(type=>({type,label:definitions[type].label}));
}
export function importAllowed(a,type){
 must(importTypes(a).some(x=>x.type===type),403,'Импорт справочника недоступен');
}
function colNumber(s){let n=0;for(const c of s)n=n*26+c.charCodeAt(0)-64;return n}
async function parseBook(file){
 must(typeof file==='string'&&file.length<=Math.ceil(MAX_FILE/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(file),400,'Выберите XLSX до 2 МБ');
 const bytes=Buffer.from(file,'base64');must(bytes.length<=MAX_FILE&&bytes.toString('base64')===file,400,'Некорректный XLSX');
 try{
  const entries=await readZip(bytes);
  must(entries.length<=1000&&entries.reduce((n,e)=>n+e.bytes.length,0)<=MAX_EXPANDED,413,'Распакованный XLSX превышает лимит');
  const dec=new TextDecoder('utf-8',{fatal:true});
  for(const e of entries){
   must(!/(^\/|\\|:|vbaProject|externalLinks|embeddings|activeX|customUI|connections\.xml|queryTables)/i.test(e.name),422,'Макросы, объекты и внешние связи запрещены');
   if(/\.(xml|rels)$/i.test(e.name)){
    const xml=dec.decode(e.bytes);
    must(!/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*['"]External['"]/i.test(xml),422,'Внешние связи и DTD запрещены');
    if(/^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)){
     for(const m of xml.matchAll(/<(?:\w+:)?(?:row|c)\b[^>]*\br\s*=\s*["']([A-Z]*)(\d+)["']/g))must(Number(m[2])<=1000&&(!m[1]||colNumber(m[1])<=100),413,'Слишком большие координаты ячеек');
    }
   }
  }
  // Rebuild from verified uncompressed parts so the XLSX parser cannot
  // trust inconsistent local ZIP headers or inflate unbounded input.
  const book=await loadWorkbook(excelJS(),zipStored(entries));
  must(book.worksheets.length<=20,413,'Не более 20 листов');
  return {book,sha:hash(bytes)};
 }catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Не удалось прочитать безопасный XLSX: '+String(e.message||'ошибка').split('\n')[0].slice(0,160))}
}
function inspectSheet(book,f){
 must(Number.isSafeInteger(f.sheet)&&f.sheet>=0&&f.sheet<book.worksheets.length&&Number.isSafeInteger(f.header_row)&&f.header_row>=1&&f.header_row<=20,400,'Выберите лист и строку заголовков 1–20');
 const sheet=book.worksheets[f.sheet];must(sheet.columnCount<=100&&sheet.rowCount-f.header_row<=MAX_ROWS,413,'Не более 200 строк данных и 100 колонок');
 try{return {sheet,headers:sheetHeaders(sheet,f.header_row)}}catch(e){throw new PilotError(422,String(e.message))}
}
export async function inspectDirectoryFile(f){
 must(exact(f,['type','file','sheet','header_row'])&&dirTypes.includes(f.type),400,'Неверный запрос импорта');
 const {book}=await parseBook(f.file),{headers}=inspectSheet(book,f),mapping=autoMap(f.type,headers);
 if(f.type==='person'){
  const other=autoMap('person_assignment',headers);
  for(const k of extra)if(other[k]&&!Object.values(mapping).includes(other[k]))mapping[k]=other[k];
 }
 return {sheets:book.worksheets.map((s,i)=>({index:i,name:s.name})),headers,fields:Object.entries(specs(f.type)).map(([k,v])=>({key:k,label:label(f.type,k),required:!!v.required||f.type==='org_unit'&&k==='parent_id',col:mapping[k]??null})),max_rows:MAX_ROWS};
}
export async function parseDirectoryFile(f,commit=false){
 must(exact(f,['type','file','sheet','header_row','mapping','allow_updates',...(commit?['token']:[])])&&dirTypes.includes(f.type)&&typeof f.allow_updates==='boolean',400,'Неверные поля импорта');
 const {book,sha}=await parseBook(f.file),{sheet,headers}=inspectSheet(book,f),fields=specs(f.type),keys=Object.keys(fields);
 must(f.mapping&&typeof f.mapping==='object'&&!Array.isArray(f.mapping)&&Object.keys(f.mapping).every(k=>keys.includes(k))&&Object.values(f.mapping).every(n=>Number.isSafeInteger(n)&&headers.some(h=>h.col===n))&&new Set(Object.values(f.mapping)).size===Object.values(f.mapping).length,400,'Проверьте соответствие колонок');
 must(Object.entries(fields).every(([k,v])=>!(v.required||f.type==='org_unit'&&k==='parent_id')||Object.hasOwn(f.mapping,k)),400,'Сопоставьте обязательные колонки');
 let data;try{data=sheetRows(sheet,f.header_row,f.mapping)}catch(e){throw new PilotError(422,String(e.message))}
 must(data.length>0&&data.length<=MAX_ROWS,422,'Нет строк данных или превышен лимит');
 const parsed=data.map(row=>{try{
  const values={};for(const [k,v] of Object.entries(row.values))values[k]=cellText(v,fields[k],k);
  for(const [k,v] of Object.entries(fields))if(v.required&&!(f.type==='person'&&k==='unit_id'))must(values[k],422,'Заполните '+label(f.type,k));
  return {row:row.row,values};
 }catch(e){return {row:row.row,error:String(e.message).slice(0,240)}}});
 return {type:f.type,sha,sheet:f.sheet,header_row:f.header_row,mapping:f.mapping,allow_updates:f.allow_updates,data:parsed};
}
function stamp(db,a,p){return canonical({database:meta(db,'database_id'),actor:a.accountId,revision:a.credentialRevision,day:a.day,domain:one(db,'SELECT count(*) n FROM change_event').n,security:one(db,'SELECT count(*) n FROM lc81_audit').n,sha:p.sha,type:p.type,sheet:p.sheet,header_row:p.header_row,mapping:p.mapping,allow_updates:p.allow_updates})}
const sign=(v,until)=>createHmac('sha256',secret).update(until+'|'+v).digest('hex');
export function makeImportToken(db,a,p){
 const until=Date.now()+10*60*1000;return until+'.'+sign(stamp(db,a,p),until);
}
export function checkImportToken(db,a,p,token){
 must(typeof token==='string'&&/^\d{13}\.[a-f0-9]{64}$/.test(token),409,'Выполните предварительную проверку');
 const [until,mac]=token.split('.'),end=Number(until);
 must(end>=Date.now()&&end<=Date.now()+10*60*1000&&timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(sign(stamp(db,a,p),until),'hex')),409,'Данные, права или файл изменились. Выполните предварительную проверку снова');
}
const refAction=type=>DIRECTORIES[type]?.read;
function resolveRef(db,access,type,value,unit){
 if(!value)return null;
 let code=value,target=unit;
 if(['equipment','operation','workplace'].includes(type)&&value.includes('/')){
  const i=value.indexOf('/');target=resolveRef(db,access,'org_unit',value.slice(0,i),null);code=value.slice(i+1);
 }
 let all=list(db,type).filter(x=>!x.archived&&foldKey(x.code)===foldKey(code));
 if(['equipment','operation','workplace'].includes(type)&&target)all=all.filter(x=>x.unit_id===target);
 must(all.length===1&&access.read(refAction(type),all[0].id),422,'Ссылка не найдена, неоднозначна или недоступна: '+value);
 return all[0].id;
}
function display(access,f,value){
 if(value===null||value===undefined)return null;
 if(!f.ref)return value;
 const x=access.read(refAction(f.ref),value)?.data;
 return x?[x.code,x.name||x.display_name].filter(Boolean).join(' · '):'Недоступная ссылка';
}
function oldIdentity(db,p,v){
 const d=definitions[p.type],key=identityKey(p.type,v);
 return {key,records:list(db,p.type).filter(r=>identityKey(p.type,r)===key)};
}
export function planDirectoryImport(db,a,p,access){
 importAllowed(a,p.type);
 const results=[],seen=new Set(),fields=specs(p.type),dir=DIRECTORIES[p.type];
 // Parent-first ordering for org units in the same file, just like the
 // existing local import. Other reference types must already exist.
 let data=p.data;
 if(p.type==='org_unit'){
  const remaining=[...data],ordered=[],known=new Set(list(db,'org_unit').filter(r=>!r.archived&&access.read('org.read',r.id)).map(r=>foldKey(r.code)));
  while(remaining.length){
   const i=remaining.findIndex(x=>x.error||!x.values.parent_id||known.has(foldKey(x.values.parent_id))||!remaining.some(y=>y.values?.code&&foldKey(y.values.code)===foldKey(x.values.parent_id)));
   if(i<0){ordered.push(...remaining.map(x=>({...x,error:'Цикл или неразрешённая зависимость подразделений'})));break}
   const [x]=remaining.splice(i,1);ordered.push(x);if(x.values?.code)known.add(foldKey(x.values.code));
  }data=ordered;
 }
 for(const item of data){
  const result={row:item.row,status:'error',message:item.error||'',changes:[]};results.push(result);
  if(item.error)continue;
  db.run('SAVEPOINT lc81_import_row');
  try{
   const v={};
   for(const [k,f] of Object.entries(fields))if(Object.hasOwn(item.values,k))v[k]=f.ref?resolveRef(db,access,f.ref,item.values[k],v.unit_id):item.values[k];
   if(p.type==='rating_scale'&&v.levels)v.levels=parseLevels(v.levels).map(x=>x.value+': '+x.label).join('\n');
   const {key,records}=oldIdentity(db,p,v);
   must(key&&!seen.has(key),422,'Повтор ключа внутри файла');seen.add(key);
   must(records.length<=1&&records.every(r=>!r.archived&&access.read(dir.read,r.id)),422,'Ключ конфликтует с существующей или недоступной записью');
   const old=records[0]||null,previous=old?recordPayload(p.type,old):null;
   if(old&&p.type==='person'){
    const emp=rows(db,"SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[old.id,a.day,a.day]);
    must(emp.length===1,422,'Требуется отдельное кадровое назначение');
    for(const k of extra)if(v[k]!=null)must(v[k]===emp[0][k],422,'Кадровое перемещение оформляется отдельно');
   }
   const names=Object.keys(definitions[p.type].fields),next=Object.fromEntries(names.map(k=>[k,Object.hasOwn(v,k)?v[k]:previous?.[k]??null]));
   if(old){if(p.type==='person')next.employee_code=previous.employee_code;else if(Object.hasOwn(next,'code'))next.code=previous.code;}
   if(!old&&p.type==='person')for(const k of extra)next[k]=v[k]??null;
   if(old&&canonical(previous)===canonical(next)){result.status='same';result.message='Без изменений';db.run('RELEASE lc81_import_row');continue}
   must(!old||p.allow_updates,422,'Ключ существует; обновление требует явного разрешения');
   must(!old||dir.update,422,'Запись неизменяема; создайте новую версию');
   result.changes=Object.entries(next).filter(([k,value])=>!old||value!==previous[k]).map(([k,value])=>({field:label(p.type,k),before:display(access,fields[k],previous?.[k]),after:display(access,fields[k],value)}));
   applyDirectoryCommand(db,{type:p.type,operation:old?'update':'create',id:old?.id??null,expected_revision:old?.rev??0,fields:next},access);
   result.status=old?'update':'create';result.message=old?'Проверено обновление':'Проверено создание';
   db.run('RELEASE lc81_import_row');
  }catch(e){db.run('ROLLBACK TO lc81_import_row');db.run('RELEASE lc81_import_row');result.changes=[];result.message=e instanceof PilotError&&e.status===403?'Запись или операция недоступна':String(e.message||'Проверка не пройдена').split('\n')[0].slice(0,240)}
 }
 results.sort((a,b)=>a.row-b.row);
 const counts=Object.fromEntries(['create','update','same','error'].map(k=>[k,results.filter(x=>x.status===k).length]));
 return {results,counts,can_commit:counts.error===0&&counts.create+counts.update>0};
}
