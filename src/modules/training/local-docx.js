// Local-only OOXML template filling. ZIP is parsed without external libraries.
import {invariant} from '../../core/db.js';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const max=32*1024*1024,W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const table=Uint32Array.from({length:256},(_,i)=>{let x=i;for(let j=0;j<8;j++)x=x&1?0xedb88320^(x>>>1):x>>>1;return x>>>0});
export function crc32(b){let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function concat(arr){const out=new Uint8Array(arr.reduce((n,b)=>n+b.length,0));let p=0;for(const b of arr){out.set(b,p);p+=b.length}return out}
export function zipStored(entries){
 let offset=0;const local=[],central=[];
 invariant(entries.length<=2000,'Слишком много частей DOCX');
 for(const e of entries){
  const name=enc.encode(e.name),bytes=typeof e.bytes==='string'?enc.encode(e.bytes):e.bytes;
  invariant(name.length>0&&name.length<65536&&bytes.length<=max,'Некорректная часть DOCX');
  const crc=crc32(bytes),lh=new Uint8Array(30),a=new DataView(lh.buffer);
  a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(6,0x800,true);a.setUint32(14,crc,true);a.setUint32(18,bytes.length,true);a.setUint32(22,bytes.length,true);a.setUint16(26,name.length,true);
  const ch=new Uint8Array(46),b=new DataView(ch.buffer);b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint16(8,0x800,true);b.setUint32(16,crc,true);b.setUint32(20,bytes.length,true);b.setUint32(24,bytes.length,true);b.setUint16(28,name.length,true);b.setUint32(42,offset,true);
  local.push(lh,name,bytes);central.push(ch,name);offset+=lh.length+name.length+bytes.length
 }
 const c=concat(central),end=new Uint8Array(22),d=new DataView(end.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.length,true);d.setUint16(10,entries.length,true);d.setUint32(12,c.length,true);d.setUint32(16,offset,true);
 return concat([...local,c,end])
}
export async function readZip(bytes){
 invariant(bytes instanceof Uint8Array&&bytes.length>=22&&bytes.length<=max,'Недопустимый размер DOCX');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break}
 invariant(end>=0&&u16(end+4)===0&&u16(end+6)===0&&u16(end+8)===u16(end+10),'Неподдерживаемый ZIP');
 const count=u16(end+10),size=u32(end+12),start=u32(end+16);invariant(count>0&&count<=2000&&start+size<=end,'Повреждён каталог DOCX');
 const result=[],names=new Set();let p=start,total=0;
 for(let i=0;i<count;i++){
  invariant(p+46<=start+size&&u32(p)===0x02014b50,'Повреждён каталог ZIP');
  const flag=u16(p+8),method=u16(p+10),crc=u32(p+16),packed=u32(p+20),len=u32(p+24),nl=u16(p+28),extra=u16(p+30),comment=u16(p+32),offset=u32(p+42);
  invariant(!(flag&1)&&[0,8].includes(method)&&len<=max&&p+46+nl+extra+comment<=start+size&&offset+30<=start,'Неподдерживаемый архив DOCX');
  const name=dec.decode(bytes.subarray(p+46,p+46+nl));invariant(name&&!names.has(name)&&!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').includes('..'),'Недопустимое имя части DOCX');names.add(name);
  invariant(u32(offset)===0x04034b50,'Повреждён заголовок ZIP');const data=offset+30+u16(offset+26)+u16(offset+28);invariant(data+packed<=start,'Повреждён размер части');
  total+=len;invariant(total<=max,'Распакованный DOCX слишком большой');
  let body=bytes.slice(data,data+packed);
  if(method===8){
   const stream=new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks=[];let n=0;
   try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.length;invariant(n<=len&&n<=max,'Превышен размер части DOCX');chunks.push(x.value)}}finally{await reader.cancel().catch(()=>{})}
   body=concat(chunks)
  }
  invariant(body.length===len&&crc32(body)===crc,'Контрольная сумма DOCX не совпадает');result.push({name,bytes:body});p+=46+nl+extra+comment
 }
 invariant(p===start+size,'Некорректный каталог ZIP');return result
}
function parse(xml){const x=new DOMParser().parseFromString(xml,'application/xml');invariant(!x.getElementsByTagName('parsererror').length&&!x.doctype,'Некорректный XML шаблона');return x}
const pText=p=>Array.from(p.getElementsByTagNameNS(W,'t')).map(t=>t.textContent).join('');
function setText(p,text){
 const x=p.ownerDocument,first=p.getElementsByTagNameNS(W,'r')[0],style=first?.getElementsByTagNameNS(W,'rPr')[0]?.cloneNode(true);
 for(const child of Array.from(p.children))if(child.namespaceURI===W&&child.localName!=='pPr')child.remove();
 const r=x.createElementNS(W,'w:r');if(style)r.append(style);
 const lines=String(text).split('\n');for(let i=0;i<lines.length;i++){if(i)r.append(x.createElementNS(W,'w:br'));const t=x.createElementNS(W,'w:t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=lines[i];r.append(t)}p.append(r)
}
const fmt=s=>s?String(s).split('-').reverse().join('.'):'________________';
export function orderPayment(order){
 const parts=[];if(order.instructor_amount!==null)parts.push('инструкторам — '+order.instructor_amount+' руб. на руки');if(order.trainer_amount!==null)parts.push('внутренним тренерам — '+order.trainer_amount+' руб. на руки');
 const current=(!order.order_on||order.order_on>='2025-01-29')&&(order.instructor_amount===null||order.instructor_amount===5000)&&(order.trainer_amount===null||order.trainer_amount===7000);return parts.length?'Установить ежемесячную доплату: '+parts.join('; ')+' с '+fmt(order.supplement_from)+'.'+(current?' Условие выплаты: за календарный месяц выполнено не менее двух задач инструктором или трёх задач Внутренним тренером согласно действующему стандарту; основание — ходатайство (приложение 16), решение руководителя.':''):'Доплата настоящим приказом не устанавливается.'
}
export async function fillOrderTemplate(bytes,order,members,{registered=false}={}){
 const entries=await readZip(bytes);invariant(!entries.some(e=>/vbaProject|embeddings\/|_xmlsignatures\//i.test(e.name)),'Используйте чистый DOCX-образец без макросов, вложений и подписи');
 const doc=entries.find(x=>x.name==='word/document.xml');invariant(doc,'Это не DOCX');
 const xml=parse(dec.decode(doc.bytes)),body=xml.getElementsByTagNameNS(W,'body')[0],p=Array.from(body?.children||[]).filter(x=>x.localName==='p'&&x.namespaceURI===W);
 // The supplied original has 56 paragraphs, two groups of three sample rows.
 invariant(p.length===56&&pText(p[1]).trim()==='ОБРАЗЕЦ'&&[20,21,22,27,28,29].every(i=>pText(p[i]).trim()==='ФИО, должность')&&/ПРИКАЗ/.test(pText(p[8]))&&/Директор/.test(pText(p[38])),'Структура не совпадает с предоставленным оригиналом приказа. Выберите утверждённый образец.');
 const groups=[{indexes:[20,21,22],members:members.filter(m=>m.role==='internal_trainer')},{indexes:[27,28,29],members:members.filter(m=>m.role!=='internal_trainer')}];
 // Keep the original corporate wording, styles, section geometry and list styles.
 setText(p[1],registered?'КОПИЯ РЕКВИЗИТОВ · БЕЗ ПОДПИСИ':'ПРОЕКТ · БЕЗ ПОДПИСИ');setText(p[3],order.organization);setText(p[6],fmt(order.order_on)+'    г. '+order.city);setText(p[8],'ПРИКАЗ № '+order.order_number);
 setText(p[34],orderPayment(order));setText(p[38],'Директор завода        ____________ / '+order.approved_name+' /');
 for(const g of groups){
  const [first,...rest]=g.indexes.map(i=>p[i]),parent=first.parentNode,anchor=first.nextSibling;
  const values=g.members.length?g.members.map(m=>m.person_name+', '+m.position_name):['—'];
  setText(first,values[0]);for(const v of values.slice(1)){const clone=first.cloneNode(true);setText(clone,v);parent.insertBefore(clone,anchor)}for(const x of rest)x.remove()
 }
 doc.bytes=enc.encode(new XMLSerializer().serializeToString(xml));return zipStored(entries)
}
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function paragraph(value,{bold=false,size=22,center=false}={}){return '<w:p><w:pPr>'+(center?'<w:jc w:val="center"/>':'')+'<w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'+(bold?'<w:b/>':'')+'<w:sz w:val="'+size+'"/></w:rPr><w:t xml:space="preserve">'+escape(value)+'</w:t></w:r></w:p>'}
export function draftDocx(lines,{landscape=false}={}){
 const content='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="'+W+'"><w:body>'+lines.map(x=>typeof x==='string'?paragraph(x):paragraph(x.text,x)).join('')+'<w:sectPr><w:pgSz w:w="'+(landscape?'16838':'11906')+'" w:h="'+(landscape?'11906':'16838')+'"'+(landscape?' w:orient="landscape"':'')+'/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
 return zipStored([{name:'[Content_Types].xml',bytes:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},{name:'_rels/.rels',bytes:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},{name:'word/document.xml',bytes:content}])
}

export function builtinOrderDocx(order,members,{registered=false}={}){
 const names=role=>members.filter(m=>role==='internal_trainer'?m.role===role:m.role!=='internal_trainer').map((m,i)=>(i+1)+'. '+m.person_name+', '+m.position_name);
 return draftDocx([{text:registered?'КОПИЯ РЕКВИЗИТОВ · БЕЗ ПОДПИСИ':'ПРОЕКТ · БЕЗ ПОДПИСИ',bold:true,center:true},{text:order.organization,bold:true,center:true},fmt(order.order_on)+'    г. '+order.city,{text:'ПРИКАЗ № '+order.order_number,bold:true,size:28,center:true},{text:'«О назначении Инструкторов и Внутренних тренеров»',bold:true,center:true},'С целью организации, функционирования и развитие системы обучения на рабочем месте',{text:'ПРИКАЗЫВАЮ:',bold:true},'1. Назначить Внутренними тренерами сертифицированных по программе TWI сотрудников:',...(names('internal_trainer').length?names('internal_trainer'):['—']),'2. Назначить Инструкторами сертифицированных по программе TWI сотрудников:',...(names('instructor').length?names('instructor'):['—']),'3. Отделу персонала ознакомить назначенных Внутренних тренеров и Инструкторов с задачами по указанным ролям согласно Стандарта организации и проведения производственного обучения на рабочих местах (с использованием методики TWI).','4. '+orderPayment(order),'Директор завода        ____________ / '+order.approved_name+' /'])
}

export async function sopCriteriaFromDocx(bytes){
 const entries=await readZip(bytes),doc=entries.find(x=>x.name==='word/document.xml');invariant(doc,'Это не DOCX');
 const xml=parse(dec.decode(doc.bytes)),out=[];
 for(const row of Array.from(xml.getElementsByTagNameNS(W,'tr'))){
  const cells=Array.from(row.children).filter(x=>x.namespaceURI===W&&x.localName==='tc');if(cells.length<2)continue;
  const value=x=>Array.from(x.getElementsByTagNameNS(W,'p')).map(pText).join(' ').trim(),number=value(cells[0]);
  if(!/^\d{1,3}$/.test(number))continue;
  const code=Number(number),question=value(cells[1]);invariant(code===out.length+1&&question,'Нумерация критериев должна быть последовательной');out.push({code,question})
 }
 invariant(out.length>0&&out.length<=100,'В таблице DOCX не найдены 1–100 пронумерованных требований');return out
}
