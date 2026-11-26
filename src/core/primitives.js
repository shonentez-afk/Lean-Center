// Low-level SQLite/serialization utilities. No dependency on application domain dispatch.
export const MAX_DB=100*1024*1024;
export const MAX_PACKAGE=5*1024*1024;
export const MAX_QUEUE_EVENTS=2000,MAX_QUEUE_BYTES=MAX_PACKAGE-4096;
export const uuid=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export const isId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export const invariant=(ok,msg)=>{if(!ok)throw new Error(msg)};
export const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export async function sha256(data){const b=typeof data==='string'?new TextEncoder().encode(data):data;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')}
export function encode(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)}
export function decode(s){invariant(typeof s==='string'&&s.length<=MAX_DB*1.4,'Слишком большой файл базы');return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
export function rows(db,sql,args=[]){const st=db.prepare(sql);try{st.bind(args);const result=[];while(st.step())result.push(st.getAsObject());return result}finally{st.free()}}
export const one=(db,sql,args=[])=>rows(db,sql,args)[0]||null;
export const meta=(db,key)=>one(db,'SELECT value FROM meta WHERE key=?',[key])?.value||null;
export const setMeta=(db,key,value)=>db.run('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',[key,value]);
export function tx(db,fn){db.run('BEGIN IMMEDIATE');try{const value=fn();db.run('COMMIT');return value}catch(e){db.run('ROLLBACK');throw e}}
export function bytesOf(db){const bytes=db.export();db.run('PRAGMA foreign_keys=ON');return bytes}
export const foldKey=x=>String(x??'').normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
