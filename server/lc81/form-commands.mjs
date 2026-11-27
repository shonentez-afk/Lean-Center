// Native corporate TWI 03 generators on the protected server.
// No full database, raw journal or user-supplied executable code is exported.
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {one,rows,isId} from '../../src/core/db.js';
import {STANDARD_FORMS,standardWorkbook} from '../../src/modules/training/standard-v03.js';
import {finalBlankWorkbook} from '../../src/modules/training/standard-final-prints.js';
import {assessmentMatrixWorkbook,originalChecklistMatch,supplementMatrixWorkbook,preparationStructureWorkbook} from '../../src/modules/training/standard-prints.js';
import {productionRows,productionWorkbook,practicalWorkbook} from '../../src/modules/training/corporate-forms.js';
import {builtinOrderDocx,zipStored} from '../../src/modules/training/local-docx.js';
import {entryForm,preparationForms,programFormsAvailable} from './program-form-commands.mjs';
import {matrixFromRecord,matrixProjection,matrixWorkbook} from '../../src/modules/training/matrix-view.js';
import {preparationRows} from '../../src/modules/training/standard-workflows.js';
import {assessmentAnswers} from '../../src/modules/training/assessment-review.js';
import {programResource,enrollmentResource,trainingAssignmentResource,matrixResource,assessmentResource,auditResource,selfResource,orderResource,supplementResource,preparationResource} from './read-policy.mjs';
import {qualityDetail} from './quality-commands.mjs';
import {orderDetail,supplementDetail} from './mentor-workflows.mjs';
import {preparationDetail} from './program-commands.mjs';
import {bankDetail} from './development-commands.mjs';
import {trainingDetail} from './training-commands.mjs';
import {matrixDetail} from './matrix-commands.mjs';
import {assessmentDetail} from './competency-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const allowed=(a,k,id,r)=>!!r&&a.scope(k,id,r);
const name=(a,id)=>a.read('person.read_directory',id)?.data.display_name??a.read('person.read_basic',id)?.data.display_name??'';
const find=(db,t,id)=>one(db,'SELECT * FROM '+t+' WHERE id=?',[id]);
let excel;
export function excelJS(){
 if(!excel){
  // This is the existing pinned ExcelJS browser distribution, not a
  // downloaded script, and not any content uploaded by a user.
  const url=new URL('../../baselines/sop-stage43/src/vendor/exceljs.min.js',import.meta.url);
  const module={exports:{}};
  compileFunction(readFileSync(url,'utf8'),['module','exports'],{filename:'pinned-exceljs.min.js'})(module,module.exports);
  must(typeof module.exports.Workbook==='function',503,'Генератор XLSX недоступен');excel=module.exports;
 }
 return excel;
}
const forms=STANDARD_FORMS.map(({id,title,notes,page})=>({id,title,notes,page,format:id===15?'DOCX':'XLSX'}));
export function formsCatalog(db,a){
 const r=programResource(db);must(r&&allowed(a,'forms.read',r.units[0],r),403,'Бланки недоступны');
 return {version:'03',forms,batch_types:a.personId&&a.permissions.includes('forms.export')?Object.entries(recordTypes).filter(([kind,t])=>kind!=='preparation_pack'&&a.permissions.includes(t.read)&&a.permissions.includes(t.detail)&&(!programFormKinds.has(kind)||programFormsAvailable(db,a))).map(([kind,t])=>({kind,read:t.read,appendix:t.appendix})):[]};
}
function blank(db,form){
 if(form.id===15)return {bytes:Buffer.from(builtinOrderDocx({organization:'________________',city:'________________',order_on:'',order_number:'____ /ОДП',approved_name:'________________',supplement_from:'',instructor_amount:5000,trainer_amount:7000},[])),extension:'docx'};
 const X=excelJS(),id=form.id;
 const book=[9,13,14].includes(id)?assessmentMatrixWorkbook(X,id):id===16?supplementMatrixWorkbook(X,db):id===17?preparationStructureWorkbook(X):[6,8].includes(id)?productionWorkbook(X,Array.from({length:12},()=>({values:Array(9).fill(''),facts:[],assignment:{assigned_on:'',due_on:'',state:''}})),{title:form.title}):finalBlankWorkbook(X,id)||standardWorkbook(X,form);
 return {book,extension:'xlsx'};
}
const programFormKinds=new Set(['entry','adaptation','safety_program','internship_program','preparation_pack']);
const recordTypes=Object.freeze({
 entry:{table:'training_enrollment',read:'training.enrollment.read',detail:'training.enrollment.detail',appendix:1},
 ...Object.fromEntries([['adaptation',2],['safety_program',3],['internship_program',4],['preparation_pack',17]].map(([k,appendix])=>[k,{table:'twi_preparation',read:'preparation.read',detail:'preparation.detail',appendix}])),
 training_plan:{table:'training_assignment',read:'training.read',detail:'training.detail',appendix:6},
 journal:{table:'training_assignment',read:'training.read',detail:'training.detail',appendix:8},
 matrix:{table:'competency_matrix',read:'matrix.read',detail:'matrix.detail',appendix:7},
 practical:{table:'assessment_session',read:'assessment.read',detail:'assessment.detail',appendix:9},
 bank:{table:'twi_knowledge_bank',read:'bank.read',detail:'bank.detail',appendix:10},
 audit:{table:'audit_session',read:'audit.read',detail:'audit.detail',appendix:13},
 self:{table:'mentor_self_evaluation',read:'self.read',detail:'self.detail',appendix:14},
 order:{table:'mentor_order',read:'order.read',detail:'order.detail',appendix:15},
 supplement:{table:'twi_supplement',read:'supplement.read',detail:'supplement.detail',appendix:16},
 preparation:{table:'twi_preparation',read:'preparation.read',detail:'preparation.detail',appendix:17}
});
function resource(db,a,kind,id){
 const d=recordTypes[kind],r=find(db,d.table,id);
 if(!r)return null;
 const day=a.day;
 switch(kind){
 case 'training_plan':case 'journal':return trainingAssignmentResource(db,id,day);
 case 'matrix':return matrixResource(db,r.unit_id,JSON.parse(r.roster_json),JSON.parse(r.columns_json),day,r.base_on);
 case 'practical':return r.assessment_kind==='practical'?assessmentResource(db,r,day):null;
 case 'bank':return programResource(db);
 case 'audit':return auditResource(db,r,day);
 case 'self':return selfResource(db,r,day);
 case 'order':return orderResource(db,r,day);
 case 'supplement':return supplementResource(db,r,day,JSON.parse(r.tasks_json));
 case 'entry':return find(db,'training_program',r.program_id)?.kind==='entry'?enrollmentResource(db,r,day):null;
 case 'adaptation':case 'safety_program':case 'internship_program':case 'preparation_pack':case 'preparation':return preparationResource(db,r,day);
 }
 return null;
}
export function canExportForm(db,a,kind,id){
 if(!a.personId||!Object.hasOwn(recordTypes,kind)||!isId(id)||programFormKinds.has(kind)&&!programFormsAvailable(db,a))return false;
 const t=recordTypes[kind],r=resource(db,a,kind,id);
 return !!r&&!!a.read(t.read,id)&&allowed(a,t.detail,id,r)&&allowed(a,'forms.export',id,r);
}
function methodOf(db,id){return JSON.parse(one(db,'SELECT methodology_json FROM checklist_version WHERE id=?',[id])?.methodology_json||'{}')}
function rc1Workbook(X,d){
 const w=new X.Workbook(),s=w.addWorksheet('RC1 - 20',{pageSetup:{orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=[{width:8},{width:26},{width:75},{width:24},{width:48},{width:48}];
 s.mergeCells('A1:F1');s.getCell('A1').value='АУДИТ L1 · RC1 (20 критериев) · выписка без подписи';s.getCell('A1').font={bold:true,size:14};
 s.mergeCells('A2:F2');s.getCell('A2').value=[d.mentor,d.auditor,d.operation,d.date,'v'+d.version,d.state].filter(Boolean).join(' · ');
 s.mergeCells('A3:F3');s.getCell('A3').value='Наблюдалось '+d.stats.observed+' / '+d.stats.expected+' · Да '+d.stats.yes+' · Нет '+d.stats.no;
 s.addRow(['№','Раздел','Критерий','Ответ','Комментарий','Рекомендация']);
 for(const q of d.questions)s.addRow([q.position,q.section,q.question,d.labels[q.response]||q.response,q.note||'',q.recommendation||'']);
 s.addRow(['','','Обратная связь / основание',d.summary||'',d.void_reason||'','']);
 s.eachRow((r,i)=>{r.height=i===1?30:42;r.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};if(i===4)c.font={bold:true}})});
 s.views=[{state:'frozen',ySplit:4}];return w;
}
function populated(db,a,kind,id){
 must(canExportForm(db,a,kind,id),404,'Выгрузка недоступна');
 const t=recordTypes[kind],r=find(db,t.table,id);
 if(kind==='order'){
  const d=orderDetail(db,a,id);return {bytes:Buffer.from(builtinOrderDocx(d,d.members,{registered:true})),extension:'docx',tag:'15'};
 }
 const X=excelJS();let book,tag=String(t.appendix);
 if(kind==='entry')book=entryForm(db,a,id,X);
 else if(['adaptation','safety_program','internship_program'].includes(kind))book=preparationForms(db,a,id,X,[t.appendix])[0].book;
 else if(kind==='preparation_pack'){
  const docs=preparationForms(db,a,id,X,[2,3,4]);
  const structure=populated(db,a,'preparation',id);
  return {parts:[...docs.map(v=>({book:v.book,filename:'TWI-03-'+v.id+'.xlsx'})),{book:structure.book,filename:'TWI-03-17.xlsx'}],extension:'zip',tag:'PACK'};
 }else if(kind==='audit'){
  const d=qualityDetail(db,a,'audit',id),method=methodOf(db,r.version_id);
  if(originalChecklistMatch(method,13))book=assessmentMatrixWorkbook(X,13,[{label:d.mentor,date:d.date,evaluator:d.auditor,feedback:d.summary,conclusion:d.state==='final'?'Зафиксирован':'Аннулирован',responses:d.questions.map(q=>({value:q.response==='yes'?1:q.response==='no'?0:null,note:q.note,state:d.labels[q.response]||q.response}))}],{method,date:d.date});
  else{must(d.method==='TWI_L1_RC1'&&d.questions.length===20,422,'Методика не соответствует приложению 13 или RC1');book=rc1Workbook(X,d);tag='RC1'}
 }else if(kind==='self'){
  const d=qualityDetail(db,a,'self',id),method=methodOf(db,r.method_id);
  must(originalChecklistMatch(method,14),422,'Методика не соответствует приложению 14');
  book=assessmentMatrixWorkbook(X,14,[{label:d.person_name,date:d.date,feedback:d.feedback,responses:d.questions.map(q=>({value:q.value,note:q.note}))}],{method,place:d.place,date:d.date});
 }else if(kind==='practical'){
  const d=assessmentDetail(db,a,id),method=methodOf(db,r.method_id),answers=assessmentAnswers(db,r,'practical'),op=a.read('operation.read',r.operation_id)?.data.name||'Операция';
  const rec={label:d.person+' · '+op,operation:op,date:d.assessed_on,evaluator:d.evaluator,feedback:d.feedback,conclusion:d.conclusion,responses:answers.map(q=>({value:q.value,note:q.note}))};
  if(originalChecklistMatch(method,9))book=assessmentMatrixWorkbook(X,9,[rec],{method,trainee:d.person,date:d.assessed_on});
  else{book=practicalWorkbook(X,method,[rec],{trainee:d.person});tag='practice'}
 }else if(kind==='bank'){
  const d=bankDetail(db,a,id);
  book=standardWorkbook(X,STANDARD_FORMS.find(x=>x.id===10),{fields:{'Профессия':d.profession,'Версия':d.version_no,'Дата утверждения':d.reviewed_on},rows:d.blocks.flatMap(b=>b.questions.map(q=>[q.number,b.title,q.text]))});
 }else if(kind==='matrix'){
  matrixDetail(db,a,id);const cfg=matrixFromRecord(r);
  must(cfg.roster.length*cfg.columns.length<=30000,413,'Матрица слишком велика для одной выгрузки');
  book=matrixWorkbook(X,cfg,matrixProjection(db,cfg,a.day),a.day);
 }else if(kind==='training_plan'||kind==='journal'){
  trainingDetail(db,a,id);const rev=a.read('sop.read_history',r.sop_revision_id),op=a.read('operation.read',r.operation_id);
  must(rev&&op,403,'Для выписки требуется доступ к редакции СОП и операции');
  const facts=rows(db,'SELECT * FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL ORDER BY held_at,id',[id]);
  must(facts.length<=2000,413,'Слишком много фактов для одной выгрузки');
  for(const x of facts){const v=trainingAssignmentResource(db,id,a.day,[x.mentor_id,x.witness_id].filter(Boolean),x.held_at.slice(0,10));must(v&&a.scope('training.detail',id,{...v,self:null,assigned:[]})&&a.scope('forms.export',id,{...v,self:null,assigned:[]}),403,'Исторический факт недоступен');}
  const data=productionRows([r],facts,{unit:()=>a.read('org.read',op.data.unit_id)?.data.name||'',person:p=>name(a,p),revision:()=>rev.data.code+' · '+rev.data.title+' · v'+rev.data.version_no});
  book=productionWorkbook(X,data,{title:STANDARD_FORMS.find(x=>x.id===t.appendix).title,date:a.day});
 }else if(kind==='supplement'){
  const d=supplementDetail(db,a,id);
  must(d.person_name&&d.manager_name,403,'Для выписки необходим доступ к сотрудникам');
  const p=one(db,"SELECT id,position_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[r.person_id,r.month+'-28',r.month+'-01']);
  must(!p||a.read('employment.read',p.id)&&(!p.position_id||a.read('position.read',p.position_id)),403,'Историческая должность недоступна');
  book=supplementMatrixWorkbook(X,db,[{...r,tasks:d.tasks}],r.month);
 }else if(kind==='preparation'){
  const d=preparationDetail(db,a,id);must(d.documents.every(x=>x.id),403,'Не все документы комплекта доступны');
  const b=preparationRows(db).find(x=>x.id===id);must(b&&d.trainee&&name(a,r.manager_id),403,'Комплект недоступен');
  book=preparationStructureWorkbook(X,b,{trainee:d.trainee,manager:name(a,r.manager_id)});
 }
 must(book,422,'Форма не сформирована');return {book,extension:'xlsx',tag};
}
export function prepareForm(db,a,f){
 if(f?.kind==='batch'){
  must(exact(f,['kind','items'])&&Array.isArray(f.items)&&f.items.length>=1&&f.items.length<=20&&f.items.every(x=>exact(x,['kind','id'])&&Object.hasOwn(recordTypes,x.kind)&&x.kind!=='preparation_pack'&&isId(x.id)),400,'Выберите от 1 до 20 документов');
  must(new Set(f.items.map(x=>x.kind+':'+x.id)).size===f.items.length,400,'Повторяющиеся документы');
  // Validate every selected record before constructing any workbook.
  must(f.items.every(x=>canExportForm(db,a,x.kind,x.id)),404,'Выгрузка недоступна для одной или нескольких записей');
  const parts=f.items.map(({kind,id},i)=>{const r=populated(db,a,kind,id);a.audit('forms.export.'+kind,id);return {...r,filename:String(i+1).padStart(2,'0')+'-TWI-03-'+r.tag+'-'+id+'.'+r.extension}});
  return {parts,extension:'zip',filename:'TWI-03-BATCH.zip',mime:'application/zip'};
 }
 must(exact(f,['kind','appendix','id'])&&typeof f.kind==='string',400,'Неверная форма');
 let result,target,tag;
 if(f.kind==='blank'){
  formsCatalog(db,a);const form=STANDARD_FORMS.find(x=>x.id===f.appendix);
  must(form&&f.id===null,400,'Выберите приложение 1–17');result=blank(db,form);target=programResource(db).units[0];tag=String(form.id);
 }else{
  must(f.appendix===null&&isId(f.id)&&Object.hasOwn(recordTypes,f.kind),400,'Выберите запись');
  result=populated(db,a,f.kind,f.id);target=f.id;tag=result.tag+'-'+target.slice(0,8);
 }
 a.audit(f.kind==='blank'?'forms.blank':'forms.export.'+f.kind,target);
 return {...result,filename:'TWI-03-'+tag+'.'+result.extension,mime:result.extension==='zip'?'application/zip':result.extension==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
}
export async function serializeForm(result){
 try{
  if(result.parts){const entries=[];let total=0;for(const part of result.parts){const bytes=part.bytes||Buffer.from(await part.book.xlsx.writeBuffer());total+=bytes.length;must(total<=30*1024*1024,413,'Комплект документов слишком велик');entries.push({name:part.filename,bytes})}result.bytes=Buffer.from(zipStored(entries));delete result.parts}
  else if(result.book){result.bytes=Buffer.from(await result.book.xlsx.writeBuffer());delete result.book}
 }
 catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Не удалось сформировать документ: '+String(e.message||'ошибка').slice(0,180))}
 must(Buffer.isBuffer(result.bytes)&&result.bytes.length>0&&result.bytes.length<=32*1024*1024,413,'Размер документа превышает допустимый');return result;
}
