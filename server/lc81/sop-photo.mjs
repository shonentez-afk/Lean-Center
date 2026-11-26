// A photo belongs to a specific, authorized effective revision and step.
import {one,canonical,invariant} from '../../src/core/primitives.js';
import {validateRef,inspectSource,checkContent} from '../../src/modules/library/source-validation.js';
export function photoDescriptor(db,revision,position){
 const r=one(db,"SELECT payload_json FROM document_revision WHERE id=? AND state='effective'",[revision]);
 if(!r)return null;
 const p=JSON.parse(r.payload_json),step=p.projection?.steps?.[position-1];
 if(!step?.photo)return null;
 const source=validateRef(p.source);
 if(source.kind!=='sop')return null;
 return {source,sourceId:step.source_id,projection:p.projection};
}
export async function extractPhoto(desc,text){
 await checkContent(desc.source,text);
 const parsed=await inspectSource(text,'sop');
 invariant(canonical(parsed.projection)===canonical(desc.projection),'Несогласованная проекция СОП');
 const raw=JSON.parse(text),asset=raw.photoAssets[desc.sourceId],image=asset?.rendered||asset?.original;
 const m=/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image||'');
 invariant(m,'Неверный формат изображения');
 const type=m[1].toLowerCase(),bytes=Buffer.from(m[2],'base64'),hex=bytes.subarray(0,12).toString('hex');
 const correct=type==='image/png'?hex.startsWith('89504e470d0a1a0a'):type==='image/jpeg'?hex.startsWith('ffd8ff'):type==='image/gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')):type==='image/webp'&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
 invariant(correct&&bytes.length>0,'Тип фотографии не подтверждён');
 return {type,bytes};
}
