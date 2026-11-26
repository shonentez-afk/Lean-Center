// Immutable source objects are separate from the SQLite workspace.
import {invariant,canonical} from '../../core/db.js';
import {checkContent,unionRefs,validateRef} from './domain.js';
import * as local from '../../storage/local.js';
import * as net from '../../storage/network.js';
export const MAX_TRANSFER=150*1024*1024;
const key=r=>'content:'+r.sha256;
export class ContentStore{
 constructor(getCache,getFolder,getRemote=()=>null){this.getCache=getCache;this.getFolder=getFolder;this.getRemote=getRemote;this.memory=new Map()}
 async put(ref,text){
  await checkContent(ref,text);const cache=this.getCache();
  if(cache){const old=await local.load(cache,key(ref));if(old!==undefined){await checkContent(ref,old);return old}await local.save(cache,key(ref),text);return text}
  const total=[...this.memory.values()].reduce((n,x)=>n+x.length*2,0);
  invariant(this.memory.has(ref.sha256)||total+text.length*2<=MAX_TRANSFER,'Лимит памяти исходных файлов; подключите локальный кэш или сетевую папку');
  this.memory.set(ref.sha256,text);return text
 }
 async get(ref,{network=true}={}){
  validateRef(ref);const cache=this.getCache(),v=cache?await local.load(cache,key(ref)):this.memory.get(ref.sha256);
  if(v!==undefined)return checkContent(ref,v);
  const remote=this.getRemote();if(network&&remote)return this.put(ref,await remote.get(ref));
  const h=this.getFolder();invariant(network&&h,'Исходный файл не в локальном кэше. Подключите общую папку или восстановите полную копию.');
  const text=await net.readContent(h,ref);return this.put(ref,text)
 }
}
export async function makeTransfer(kind,payload,refs,read){
 refs=unionRefs(refs);
 if(!refs.length)return payload;
 let size=new TextEncoder().encode(canonical(payload)).length;const contents=[];
 for(const ref of refs){const text=await checkContent(ref,await read(ref));size+=new TextEncoder().encode(JSON.stringify(text)).length+256;invariant(size<=MAX_TRANSFER-65536,'Полная копия превышает 150 МБ; используйте сетевое хранилище с отдельным резервированием');contents.push({ref,text})}
 return {format:'lean-content-bundle-v1',kind,payload,contents}
}
export function unpackTransfer(value,kind){
 if(value?.format!=='lean-content-bundle-v1')return {payload:value,contents:[]};
 invariant(value.kind===kind&&Array.isArray(value.contents)&&value.contents.length<=10000&&Object.hasOwn(value,'payload'),'Некорректный комплект исходных файлов');
 return {payload:value.payload,contents:value.contents}
}
export async function restoreContents(contents,refs,put){
 refs=unionRefs(refs);const expected=new Map(refs.map(r=>[r.sha256,r]));
 invariant(contents.length===expected.size,'Неполный комплект исходных файлов: ожидалось '+expected.size+', получено '+contents.length);
 const seen=new Set();
 for(const item of contents){invariant(item&&typeof item==='object'&&Object.keys(item).length===2,'Некорректный элемент комплекта');const ref=validateRef(item.ref),match=expected.get(ref.sha256);invariant(match&&canonical(match)===canonical(ref)&&!seen.has(ref.sha256),'Лишний, повторный или несогласованный файл');seen.add(ref.sha256);await checkContent(ref,item.text)}
 // No local writes before every member is checked. Orphans are harmless if
 // the subsequent database transaction or local CAS fails.
 for(const item of contents)await put(item.ref,item.text);
}
