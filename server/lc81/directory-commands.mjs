// Server-only typed commands; reuse the existing registry schema and applyEvent.
import {definitions,applyEvent,recordPayload,uuid,one,isId} from '../../src/core/db.js';
import {DIRECTORIES} from './access-contract.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fieldNames=t=>Object.keys(definitions[t].fields);
export function directorySchema(type){
 if(!Object.hasOwn(DIRECTORIES,type))return null;
 const d=definitions[type];
 return {label:d.label,fields:d.fields,createFields:type==='person'?{...d.fields,unit_id:{label:'Подразделение',ref:'org_unit',required:true}}:d.fields,lockedFields:type==='org_unit'?['parent_id','kind']:type==='person'?[]:['unit_id']};
}
// Commands accept only domain fields, never actor_id, arbitrary event payloads,
// server revisions, SQL or permission changes. Caller verifies current session.
export function applyDirectoryCommand(db,input,{day,at,read,allows,audit,site}){
 must(exact(input,['type','operation','id','expected_revision','fields'])&&Object.hasOwn(DIRECTORIES,input.type),400,'Неизвестный справочник');
 const {type,operation,id,expected_revision,fields}=input,d=DIRECTORIES[type];
 must(['create','update','archive'].includes(operation)&&d[operation],403,'Действие недоступно');
 const creating=operation==='create',archiving=operation==='archive';
 must(creating?id===null&&expected_revision===0:isId(id)&&Number.isSafeInteger(expected_revision)&&expected_revision>0,400,'Неверная версия записи');
 const names=fieldNames(type),allowedKeys=type==='person'&&creating?[...names,'unit_id']:names;
 must(archiving?fields===null:exact(fields,allowedKeys)&&Object.values(fields).every(v=>v===null||typeof v==='string'),400,'Неверные поля справочника');
 let old,anchor,anchorAction;
 if(creating){
  anchor=type==='org_unit'?fields.parent_id:fields.unit_id;anchorAction='org.read';
  must(isId(anchor)&&read(anchorAction,anchor)&&allows(d.create,anchorAction,anchor),403,'Нет права создавать записи в этом подразделении');
  if(type==='org_unit')must(fields.kind!=='Предприятие',422,'Создание второй площадки запрещено');
 }else{
  // Authorization precedes version/existence checks to avoid cross-scope oracle.
  anchor=id;anchorAction=d.read;
  must(read(d.read,id)&&allows(d[operation],anchorAction,anchor),403,'Запись недоступна для изменения');
  old=one(db,'SELECT * FROM '+type+' WHERE id=? AND archived=0',[id]);
  must(old?.rev===expected_revision,409,'Запись изменилась. Обновите данные.');
  if(!archiving){
   for(const key of directorySchema(type).lockedFields)must((fields[key]||null)===(old[key]||null),403,'Перенос и изменение структуры требуют отдельной операции');
  }
 }
 if(!archiving&&type==='operation'){
  for(const [key,action] of [['equipment_id','equipment.read'],['workplace_id','workplace.read']]){
   if(fields[key]&&(creating||fields[key]!==old[key]))must(isId(fields[key])&&read(action,fields[key]),403,'Связанная запись недоступна');
  }
 }
 const entityId=creating?uuid():id,eventId=uuid();
 const payload=archiving?null:Object.fromEntries(names.map(k=>[k,fields[k]]));
 try{
  applyEvent(db,{id:eventId,entity_type:type,entity_id:entityId,operation,expected_revision,payload,occurred_at:at});
  if(type==='person'&&creating){
   const assignmentId=uuid(),assignmentEvent=uuid();
   applyEvent(db,{id:assignmentEvent,entity_type:'person_assignment',entity_id:assignmentId,operation:'create',expected_revision:0,payload:{person_id:entityId,unit_id:fields.unit_id,profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:day,valid_to:null},occurred_at:at});
   audit('directory.person.initial_assignment',assignmentEvent);
  }
 }catch(e){throw new PilotError(422,'Запись не прошла существующую проверку: '+String(e.message||'некорректные поля').split('\n')[0].slice(0,240))}
 audit(d[operation],eventId);
 const result=one(db,'SELECT id,rev,archived FROM '+type+' WHERE id=?',[entityId]);
 return {id:result.id,rev:result.rev,archived:result.archived};
}
