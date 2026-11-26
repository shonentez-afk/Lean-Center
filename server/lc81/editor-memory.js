// Bundled before any pinned Stage43 script in the opaque sandbox. Native
// browser persistence is unavailable there; keep the editor's existing
// IndexedDB/photo APIs working against an ephemeral in-memory implementation.
import * as idb from 'fake-indexeddb';
for(const name of ['indexedDB','IDBCursor','IDBCursorWithValue','IDBDatabase','IDBFactory','IDBIndex','IDBKeyRange','IDBObjectStore','IDBOpenDBRequest','IDBRequest','IDBTransaction','IDBVersionChangeEvent']){
 if(!(name in idb))throw Error('Missing editor memory API '+name);
 Object.defineProperty(globalThis,name,{value:idb[name],writable:false,configurable:false});
}
function storage(){
 const entries=new Map(),api={
  get length(){return entries.size},
  key(i){return [...entries.keys()][i]??null},
  getItem(k){return entries.get(String(k))??null},
  setItem(k,v){k=String(k);v=String(v);let size=k.length+v.length;for(const [key,value] of entries)if(key!==k)size+=key.length+value.length;if(size>24*1024*1024)throw new DOMException('Working copy memory limit','QuotaExceededError');entries.set(k,v)},
  removeItem(k){entries.delete(String(k))},clear(){entries.clear()}
 };
 return api;
}
for(const name of ['localStorage','sessionStorage'])Object.defineProperty(globalThis,name,{value:storage(),writable:false,configurable:false});
