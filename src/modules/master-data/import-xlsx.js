import {definitions,foldKey,identityKey,recordPayload,openDb,bytesOf,rows,list,one,meta,uuid,now,canonical,tx,applyEvent,invariant} from '../../core/db.js';

export const MAX_ROWS=1000, MAX_COLUMNS=100, MAX_XLSX=20*1024*1024;
const MAX_EXPANDED=100*1024*1024;
const normalized=s=>foldKey(s).replace(/[^\p{L}\p{N}]+/gu,'');
export function fieldLabel(type,key){
 const f=definitions[type].fields[key];
 if(f.ref){if(f.ref==='person')return 'Табельный номер сотрудника';if(f.ref==='skill_category')return 'Название категории';if(f.ref==='equipment')return 'Код оборудования';if(f.ref==='operation')return 'Код операции (подразделение/код)';return 'Код '+({org_unit:key==='parent_id'?'родительского подразделения':'подразделения',profession:'профессии',position:'должности',work_shift:'смены',business_role:'роли'})[f.ref]}
 return f.label;
}
export function importFields(type){return Object.entries(definitions[type].fields).filter(([,f])=>!f.legacy)}
export function autoMap(type,headers){
 const result={};const used=new Set();
 for(const [key,f] of importFields(type)){
  const aliases=[key,fieldLabel(type,key),f.label];
  if(key==='display_name')aliases.push('ФИО','Фамилия Имя Отчество','Сотрудник');
  if(key==='employee_code')aliases.push('Табельный','Табельный №','Табельный номер');
  if(key==='name')aliases.push('Наименование');
  const exact=headers.filter(h=>!used.has(h.col)&&aliases.some(a=>normalized(a)===normalized(h.name)));
  if(exact.length===1){result[key]=exact[0].col;used.add(exact[0].col)}
 }
 return result;
}
// Reject unsupported/encrypted/oversized ZIP containers before ExcelJS expands them.
export function checkXlsxContainer(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 invariant(bytes.length>=22&&bytes.length<=MAX_XLSX,'XLSX до 20 МБ');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break}}
 invariant(end>=0,'Файл не является обычным XLSX (ZIP)');
 invariant(v.getUint16(end+4,true)===0&&v.getUint16(end+6,true)===0,'Многотомный ZIP не поддерживается');
 const n=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
 invariant(n===v.getUint16(end+8,true)&&n>0&&n<=2000&&start+size===end,'Некорректный каталог XLSX');
 let p=start,total=0;const names=new Set();
 for(let i=0;i<n;i++){
  invariant(p+46<=end&&v.getUint32(p,true)===0x02014b50,'Повреждённый каталог XLSX');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),uncompressed=v.getUint32(p+24,true),len=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true);
  invariant(!(flags&1)&&[0,8].includes(method)&&p+46+len+extra+comment<=end,'Неподдерживаемый ZIP');
  const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+len));invariant(!names.has(name)&&!name.split('/').includes('..'),'Повтор или недопустимый путь в ZIP');names.add(name);
  total+=uncompressed;invariant(total<=MAX_EXPANDED,'Распакованный XLSX превышает 100 МБ');p+=46+len+extra+comment;
 }
 invariant(p===end&&names.has('[Content_Types].xml')&&names.has('xl/workbook.xml'),'Некорректная структура XLSX');
 invariant(![...names].some(n=>/vbaProject\.bin|externalLinks\//i.test(n)),'Файлы с макросами или внешними связями не поддерживаются');
}
export async function loadWorkbook(ExcelJS,buffer){invariant(ExcelJS?.Workbook,'Локальная библиотека ExcelJS не загружена');checkXlsxContainer(buffer);const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);invariant(book.worksheets.length>0&&book.worksheets.length<=50,'Допустимо от 1 до 50 листов');return book}
export function sheetHeaders(sheet,row=1){invariant(Number.isInteger(row)&&row>=1&&row<=20,'Строка заголовков: 1–20');invariant(sheet.columnCount<=MAX_COLUMNS,'Лист содержит более 100 колонок');const r=sheet.getRow(row),out=[];for(let col=1;col<=sheet.columnCount;col++){const name=r.getCell(col).text.trim();out.push({col,name:name||'Колонка '+col})}return out}
export function sheetRows(sheet,headerRow,mapping){
 invariant(sheet.rowCount-headerRow<=MAX_ROWS,'В одном импорте не более '+MAX_ROWS+' строк; разделите таблицу');
 const out=[];
 for(let n=headerRow+1;n<=sheet.rowCount;n++){
  const row=sheet.getRow(n),values={};
  for(const [key,col] of Object.entries(mapping))if(col)values[key]=row.getCell(col).value;
  if(Object.values(values).some(v=>v!==null&&v!==undefined&&v!==''))out.push({row:n,values});
 }
 return out;
}
function cellText(v,f,key){
 if(v===null||v===undefined||v==='')return null;
 if(v instanceof Date){invariant(f.date&&!isNaN(v.getTime()),'Дата в текстовой колонке');return v.toISOString().slice(0,10)}
 if(typeof v==='object'){if(Array.isArray(v.richText))v=v.richText.map(t=>t.text).join('');else throw Error('Формулы, ошибки и ссылки не импортируются; вставьте значения')}
 if(typeof v==='number'){invariant(f.integer,'Коды и текстовые значения должны быть текстом в Excel (сохраните ведущие нули)');v=String(v)}
 invariant(typeof v==='string','Неподдерживаемый тип ячейки');v=v.trim();if(!v)return null;
 if(key==='criticality')v=({'обычная':'normal','важная':'important','критическая':'critical'})[foldKey(v)]||v;
 if(f.date){const m=v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);if(m)v=m[3]+'-'+m[2]+'-'+m[1]}
 return v;
}
function findRef(db,ref,value,unitId){
 if(!value)return null;
 let matches=list(db,ref).filter(x=>!x.archived);
 if(ref==='equipment'||ref==='operation'){
  let code=value,unit=unitId;const split=value.indexOf('/');
  if(split>=0){const u=value.slice(0,split);const found=list(db,'org_unit').filter(x=>!x.archived&&foldKey(x.code)===foldKey(u));invariant(found.length===1,'Неоднозначный/неизвестный код подразделения: '+u);unit=found[0].id;code=value.slice(split+1)}
  matches=matches.filter(x=>(!unit||x.unit_id===unit)&&foldKey(x.code)===foldKey(code));
 }else matches=matches.filter(x=>foldKey(ref==='person'?x.employee_code:ref==='skill_category'?x.name:x.code)===foldKey(value));
 invariant(matches.length===1,'Не найдена или неоднозначна ссылка: '+definitions[ref].label+' / '+value);
 return matches[0].id;
}
export function workspaceToken(ws){return canonical({database:meta(ws.base,'database_id'),publication:meta(ws.base,'publication_id'),count:one(ws.base,'SELECT count(*) n FROM change_event').n,pending:ws.pending.map(e=>e.id),dirty:ws.dirty})}
function previewValue(db,f,value){
 if(value==null)return null;
 if(!f.ref)return value;
 const v=one(db,'SELECT * FROM '+f.ref+' WHERE id=?',[value]);if(!v)return value;
 return (v.employee_code||v.code? (v.employee_code||v.code)+' — ':'')+(v.display_name||v.name||value);
}
const statusLabels={create:'Создать',update:'Обновить',same:'Без изменений',error:'Ошибка'};
export function planImport(ws,type,source,{allowUpdates=false}={}){
 invariant(Object.hasOwn(definitions,type),'Выберите справочник');invariant(!ws.conflicts.length,'Сначала разрешите локальные конфликты');invariant(Array.isArray(source)&&source.length>0&&source.length<=MAX_ROWS,'Нет строк или превышен лимит 1000');
 const d=definitions[type],db=openDb(ws.SQL,bytesOf(ws.working)),results=[],events=[],seen=new Map();
 try{
  const parsed=source.map(item=>{try{const v={};for(const [k,raw] of Object.entries(item.values)){invariant(Object.hasOwn(d.fields,k)&&!d.fields[k].legacy,'Неизвестная колонка '+k);v[k]=cellText(raw,d.fields[k],k)}return {row:item.row,v}}catch(e){return {row:item.row,error:e.message}}});
  // Parent-before-child even when the source sheet is in arbitrary order.
  if(type==='org_unit'){
   const remaining=parsed.slice(),ordered=[],known=new Set(list(db,type).map(x=>foldKey(x.code)));
   while(remaining.length){const i=remaining.findIndex(x=>x.error||!x.v.parent_id||known.has(foldKey(x.v.parent_id))||!remaining.some(y=>y.v&&foldKey(y.v.code)===foldKey(x.v.parent_id)));if(i<0){for(const x of remaining)ordered.push({...x,error:'Цикл или неразрешённая зависимость подразделений'});break}const [x]=remaining.splice(i,1);ordered.push(x);if(x.v?.code)known.add(foldKey(x.v.code))}
   parsed.splice(0,parsed.length,...ordered)
  }
  for(const item of parsed){
   const result={row:item.row,status:'error',message:'',changes:[]};results.push(result);
   if(item.error){result.message=item.error;continue}
   try{
    const p={};for(const [k,f] of Object.entries(d.fields)){
     if(!Object.hasOwn(item.v,k)){p[k]=null;continue}
     p[k]=f.ref?findRef(db,f.ref,item.v[k],p.unit_id):item.v[k]
    }
    // Stable identities are mandatory even in an update import.
    const keys=type==='person'?['employee_code']:type==='person_assignment'?['person_id','valid_from']:type==='role_assignment'?['person_id','role_id','valid_from']:type==='skill_category'?['name']:type==='skill'?['category_id','name']:type==='rating_scale'?['name','version_no']:['equipment','operation'].includes(type)?['unit_id','code']:['code'];
    invariant(keys.every(k=>p[k]!=null),'Не заполнен ключ: '+keys.map(k=>fieldLabel(type,k)).join(', '));
    const key=identityKey(type,p);
    if(seen.has(key)){const previous=seen.get(key);previous.status='error';previous.message='Дубликат ключа в файле (строка '+item.row+')';throw Error('Дубликат ключа в файле (строка '+previous.row+')')}
    seen.set(key,result);
    const matches=list(db,type).filter(v=>identityKey(type,v)===key);
    invariant(matches.length<=1,'Неоднозначный ключ в базе');const old=matches[0];
    invariant(!old?.archived,'Ключ принадлежит архивной записи; автоматическое восстановление запрещено');
    const oldPayload=old?recordPayload(type,old):null;
    if(old)for(const k of Object.keys(d.fields))if(!Object.hasOwn(item.v,k))p[k]=oldPayload[k];
    if(type==='rating_scale'&&p.levels){p.levels=p.levels.split(/\r?\n/).filter(x=>x.trim()).map(x=>x.trim()).join('\n')}
    if(old&&canonical(p)===canonical(oldPayload)){result.status='same';result.message='Совпадает с записью базы';continue}
    result.changes=Object.entries(p).filter(([k,v])=>!old||oldPayload[k]!==v).map(([k,v])=>({field:fieldLabel(type,k),before:previewValue(db,d.fields[k],oldPayload?.[k]??null),after:previewValue(db,d.fields[k],v)}));
    invariant(!old||allowUpdates,'Ключ уже существует, данные отличаются. Включите обновление после проверки.');
    const e={id:uuid(),entity_type:type,entity_id:old?.id||uuid(),operation:old?'update':'create',expected_revision:old?.rev||0,payload:p,occurred_at:now()};
    tx(db,()=>applyEvent(db,e));events.push(e);result.status=e.operation;result.message=old?'Проверено изменение существующей записи':'Проверена новая запись';
   }catch(e){result.message=e.message}
  }
  results.sort((a,b)=>a.row-b.row);
  const counts=Object.fromEntries(Object.keys(statusLabels).map(k=>[k,results.filter(x=>x.status===k).length]));
  return {type,token:workspaceToken(ws),results,counts,events:counts.error?[]:events};
 }finally{db.close()}
}
export function commitImport(ws,plan){invariant(plan&&plan.counts.error===0&&plan.events.length>0,'Нет проверенных изменений для импорта');invariant(plan.token===workspaceToken(ws),'Рабочая копия изменилась; выполните предварительную проверку снова');return ws.applyBatch(plan.events)}
export async function makeTemplate(ExcelJS,type){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(definitions[type].label.slice(0,31));
 sheet.columns=importFields(type).map(([k,f])=>({header:fieldLabel(type,k),key:k,width:f.multiline?55:f.ref?26:28,style:{numFmt:'@'}}));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};
 sheet.views=[{state:'frozen',ySplit:1}];const guide=book.addWorksheet('Инструкция');guide.getColumn(1).width=100;
 for(const t of ['Заполняйте только первый лист. Не меняйте заголовки без настройки соответствия.','Коды и табельные номера храните как текст, даты — YYYY-MM-DD или даты Excel.','Ссылки: коды уже существующих справочников. Для операций можно указать подразделение/код.','Шкала: уровни в одной ячейке, каждый с новой строки: 0: Название.','Существующие ключи не обновляются без явного разрешения. Все ошибки блокируют импорт.'])guide.addRow([t]);
 return book.xlsx.writeBuffer();
}
