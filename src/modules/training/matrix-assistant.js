// LC4.4 matrix tools. No replacement of the assessment or permission engine.
import {rows,one,invariant} from '../../core/db.js';
import {matrixKey,columnChoices,matrixFromRecord} from './matrix-view.js';
export const normalizeMatrixText=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').replace(/\s+/g,' ').trim();
export const columnIdentity=c=>c.document_id?c.skill_id+':'+c.document_id:c.skill_id;
export function matrixCatalog(db,unit='',workplace='',category=''){
 const ops=new Map(rows(db,'SELECT o.id,o.workplace_id,o.equipment_id,w.name workplace,e.name equipment FROM operation o LEFT JOIN workplace w ON w.id=o.workplace_id LEFT JOIN equipment e ON e.id=o.equipment_id').map(x=>[x.id,x]));
 const skills=new Map(rows(db,'SELECT s.id,c.name category FROM skill s JOIN skill_category c ON c.id=s.category_id').map(x=>[x.id,x.category]));
 const docs=new Map(rows(db,'SELECT id,code,title FROM document').map(x=>[x.id,x]));
 return columnChoices(db,unit,workplace,category).map(c=>({...c,workplace:ops.get(c.operation_id)?.workplace||'Без рабочего места',equipment:ops.get(c.operation_id)?.equipment||'Без оборудования',category:skills.get(c.skill_id)||'Операции по СОП',code:docs.get(c.document_id)?.code||'',documentTitle:docs.get(c.document_id)?.title||''}));
}
export function profileRequirements(db,day,scaleId){
 return rows(db,"SELECT * FROM role_requirement WHERE valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? AND scale_id=? ORDER BY profession_id,skill_id",[day,day,scaleId]);
}
export function autoMatrix(db,roster,catalog,day,scaleId,{allSops=false}={}){
 const ids=new Set(roster.map(x=>x.person_id)),people=rows(db,"SELECT a.person_id,a.profession_id FROM person_assignment a WHERE a.id=(SELECT id FROM person_assignment b WHERE b.person_id=a.person_id AND b.valid_from<=? AND coalesce(b.valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1)",[day,day]).filter(x=>ids.has(x.person_id));
 const professions=new Set(people.map(p=>p.profession_id)),req=profileRequirements(db,day,scaleId).filter(x=>professions.has(x.profession_id));
 const requiredSkills=new Set(req.map(x=>x.skill_id)),selected=[],seen=new Set(),ambiguous=[],missing=[];
 for(const id of requiredSkills){const choices=catalog.filter(x=>x.skill_id===id);if(choices.length===1){selected.push(choices[0]);seen.add(id)}else if(choices.length>1)ambiguous.push({skill_id:id,choices:choices.map(c=>c.key)});else missing.push(id)}
 if(allSops)for(const x of catalog.filter(x=>x.document_id)){if(x.skill_id&&seen.has(x.skill_id)||!x.skill_id&&selected.some(y=>y.operation_id===x.operation_id))continue;if(!x.skill_id){const matches=catalog.filter(y=>!y.skill_id&&y.operation_id===x.operation_id);if(matches.length>1){if(!ambiguous.some(y=>y.operation_id===x.operation_id))ambiguous.push({operation_id:x.operation_id,skill_id:null,choices:matches.map(y=>y.key)});continue}}if(x.skill_id&&catalog.filter(y=>y.skill_id===x.skill_id).length>1){if(!ambiguous.some(y=>y.skill_id===x.skill_id))ambiguous.push({skill_id:x.skill_id,choices:catalog.filter(y=>y.skill_id===x.skill_id).map(y=>y.key)});continue}selected.push(x);if(x.skill_id)seen.add(x.skill_id)}
 return {keys:selected.map(x=>x.key),missing,ambiguous,unprofiled:[...professions].filter(p=>!req.some(x=>x.profession_id===p)),requirements:req.length}
}
export function profileEdits(db,{professionId,scaleId,effective,entries}){
 invariant(professionId&&scaleId&&/^\d{4}-\d{2}-\d{2}$/.test(effective),'Выберите профессию, шкалу и дату действия');
 const result=[],seen=new Set(),previous=new Date(effective+'T00:00:00Z');invariant(!isNaN(previous),'Некорректная дата');previous.setUTCDate(previous.getUTCDate()-1);const end=previous.toISOString().slice(0,10);
 for(const x of entries){invariant(x.skill_id&&!seen.has(x.skill_id)&&(x.level===null||[1,2,3,4].includes(x.level))&&['normal','important','critical'].includes(x.criticality),'Некорректная строка профиля');seen.add(x.skill_id);
  const old=one(db,"SELECT * FROM role_requirement WHERE profession_id=? AND skill_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[professionId,x.skill_id,effective,effective]);
  if(old&&old.scale_id===scaleId&&old.required_level===x.level&&old.criticality===x.criticality)continue;
  if(!old&&x.level===null)continue;
  invariant(!one(db,'SELECT id FROM role_requirement WHERE profession_id=? AND skill_id=? AND valid_from>?',[professionId,x.skill_id,effective]),'Есть будущая редакция требования. Откройте историю требований.');
  if(old){invariant(!old.valid_to&&old.valid_from<effective,'Требование уже началось в эту дату или имеет закрытый период. Выберите следующую дату либо используйте историю.');result.push({old,payload:{command:'close',valid_to:end}})}
  if(x.level!==null)result.push({old:null,payload:{profession_id:professionId,skill_id:x.skill_id,scale_id:scaleId,required_level:x.level,criticality:x.criticality,valid_from:effective,valid_to:null}})
 }
 return result
}
export function matrixActivity(db,cfg){
 const people=new Set(cfg.roster.map(x=>x.person_id)),skills=new Map(cfg.columns.map(x=>[x.skill_id,x])),map=new Map();
 for(const a of rows(db,"SELECT a.*,r.document_id,r.state revision_state FROM training_assignment a LEFT JOIN document_revision r ON r.id=a.sop_revision_id WHERE a.source_sha256 IS NOT NULL AND a.state IN('planned','in_progress') ORDER BY a.due_on,a.id")){
  const s=skills.get(a.skill_id);if(!people.has(a.trainee_id)||!s||a.scale_id!==cfg.scale_id||s.document_id&&s.document_id!==a.document_id)continue;
  const k=matrixKey(a.trainee_id,a.skill_id);if(!map.has(k))map.set(k,[]);map.get(k).push(a)
 }return map
}
export function matrixComparison(cfg,other){
 invariant(cfg.scale_id===other.scale_id,'Нельзя сравнивать разные версии шкалы');
 const identities=new Map(other.columns.map(c=>[c.skill_id,columnIdentity(c)])),values=new Map(other.baseline.map(x=>[matrixKey(x.person_id,x.skill_id),x.value]));
 const out=new Map();for(const p of cfg.roster)for(const c of cfg.columns)if(identities.get(c.skill_id)===columnIdentity(c)&&values.has(matrixKey(p.person_id,c.skill_id)))out.set(matrixKey(p.person_id,c.skill_id),values.get(matrixKey(p.person_id,c.skill_id)));
 return out
}
export function uniqueMatrixMatch(value,choices,aliases){
 const key=normalizeMatrixText(value);if(!key)return null;
 const hits=choices.filter(x=>aliases(x).some(v=>normalizeMatrixText(v)===key));
 return hits.length===1?hits[0]:null
}
export function matrixHeaderLabel(sheet,row,col){const cell=sheet.getCell(row,col),value=cell.text.trim();return value||((row>1&&cell.isMerged)?sheet.getCell(row-1,col).text.trim():'')}
export function readMatrixRange(sheet,{headerRow,firstRow,lastRow,personCol,firstSkill,lastSkill}){
 invariant([headerRow,firstRow,lastRow,personCol,firstSkill,lastSkill].every(Number.isInteger)&&headerRow>0&&firstRow>headerRow&&lastRow>=firstRow&&lastRow-firstRow<300&&lastRow<=sheet.rowCount&&personCol>0&&firstSkill>personCol&&lastSkill>=firstSkill&&lastSkill-firstSkill<150&&lastSkill<=sheet.columnCount,'Проверьте диапазон: до 300 сотрудников, 150 столбцов, без итоговых строк');
 const cols=[],people=[];
 for(let col=firstSkill;col<=lastSkill;col++){const label=matrixHeaderLabel(sheet,headerRow,col);if(label)cols.push({col,label})}
 for(let row=firstRow;row<=lastRow;row++){const label=sheet.getCell(row,personCol).text.trim();if(!label)continue;const values=cols.map(c=>{const cell=sheet.getCell(row,c.col),raw=cell.text.trim();return {col:c.col,raw,value:/^[1-4]$/.test(raw)?Number(raw):null,invalid:raw!==''&&!/^[1-4]$/.test(raw)}});people.push({row,label,values})}
 invariant(people.length&&cols.length&&people.length*cols.length<=12000,'Нет данных или превышен лимит 12000 ячеек');return {people,cols}
}
export function suggestMatrixRange(sheet){
 let headerRow=5,personCol=2,found=false;
 const isName=v=>['фио','ф и о','сотрудник','фамилия имя отчество'].includes(normalizeMatrixText(v).replace(/\./g,''));
 for(let r=1;r<=Math.min(25,sheet.rowCount)&&!found;r++)for(let c=1;c<=Math.min(12,sheet.columnCount);c++)if(isName(sheet.getCell(r,c).text)){headerRow=r;personCol=c;found=true;break}
 const firstSkill=personCol+(/должност|професси/.test(normalizeMatrixText(sheet.getCell(headerRow,personCol+1).text))?2:1);
 let lastSkill=firstSkill-1;
 for(let c=firstSkill;c<=Math.min(sheet.columnCount,firstSkill+149);c++){
  const label=normalizeMatrixText(matrixHeaderLabel(sheet,headerRow,c)),previous=headerRow>1?normalizeMatrixText(sheet.getCell(headerRow-1,c).text):'';
  const isTotal=v=>/компетенци[ияй].*сотрудник|потребност|суммарн|^итого|^состояние|^на\s+\d{1,2}[./-]\d{1,2}/.test(v);
  if(!label||isTotal(label)||isTotal(previous))break;lastSkill=c
 }
 if(lastSkill<firstSkill)lastSkill=Math.max(firstSkill,Math.min(sheet.columnCount,firstSkill+149));
 let firstRow=headerRow+1;
 for(;firstRow<=Math.min(sheet.rowCount,headerRow+8);firstRow++){const name=sheet.getCell(firstRow,personCol).text.trim();if(name&&!isName(name)&&!/^должност|^дата|^инструкторы$/i.test(name))break}
 let lastRow=firstRow-1;
 for(let r=firstRow;r<=Math.min(sheet.rowCount,firstRow+299);r++){const name=normalizeMatrixText(sheet.getCell(r,personCol).text),left=Array.from({length:personCol},(_,i)=>normalizeMatrixText(sheet.getCell(r,i+1).text)).join(' ');
  if(!name||/состояние подразделения|состояние процесса|потребности|^итого|^целевое состояние|^легенда/.test(left.trim()))break;lastRow=r
 }
 return {headerRow,personCol,firstRow,lastRow:Math.max(firstRow,lastRow),firstSkill,lastSkill}
}
export function preferredMatrixSheet(book){
 const candidates=book.worksheets.filter(s=>s.rowCount>=4&&s.columnCount>=4).filter(s=>{try{const r=suggestMatrixRange(s);return r.firstRow<=s.rowCount&&r.firstSkill<=r.lastSkill&&!!matrixHeaderLabel(s,r.headerRow,r.firstSkill)&&!/^компетенци|^потребност/i.test(matrixHeaderLabel(s,r.headerRow,r.firstSkill))}catch{return false}});
 return candidates.find(s=>normalizeMatrixText(s.name)==='матрица компетенций')||candidates[0]||book.worksheets[0]
}
export function reconcileMatrix(source,personMap,columnMap,projection){
 const people=source.people.filter(p=>personMap.get(p.row)),cols=source.cols.filter(c=>columnMap.get(c.col));
 invariant(people.length&&cols.length,'Сопоставьте сотрудников и навыки');
 invariant(new Set(people.map(p=>personMap.get(p.row))).size===people.length&&new Set(cols.map(c=>columnMap.get(c.col))).size===cols.length,'Повтор сопоставления сотрудника или столбца');
 return people.flatMap(p=>cols.map(c=>{const src=p.values.find(v=>v.col===c.col),personId=personMap.get(p.row),skillId=columnMap.get(c.col),actual=projection?.cells.get(matrixKey(personId,skillId))?.actual??null;return {personId,skillId,person:p.label,skill:c.label,raw:src.raw,imported:src.value,actual,status:src.raw==='0'?'Исходный 0 (вне шкалы 1–4)':src.invalid?'Неверное значение':src.value===null?'Пусто':actual===src.value?'Совпадает':actual===null?'Нет подтверждения':'Расхождение'}}))
}

export function matrixGroupLabels(db,columns){
 const entries=new Map(rows(db,'SELECT s.id,c.name category,w.name workplace,e.name equipment FROM skill s JOIN skill_category c ON c.id=s.category_id LEFT JOIN operation o ON o.id=s.operation_id LEFT JOIN workplace w ON w.id=o.workplace_id LEFT JOIN equipment e ON e.id=o.equipment_id').map(x=>[x.id,x]));
 return new Map(columns.map(c=>{const x=entries.get(c.skill_id||c.id);return [c.skill_id||c.id,{workplace:x?.workplace||'Без рабочего места',equipment:x?.equipment||'Без оборудования',category:x?.category||'Без категории'}]}))
}
