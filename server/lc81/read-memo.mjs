// Cache only inside a synchronous, committed store read. Mutations never
// enter this context; no result survives the request or a different database.
// Limit entries to bound memory. Callers cache only trusted read inputs.
const contexts=new WeakMap(),MAX=8192;
export function withCommittedReadMemo(db,fn){
 if(contexts.has(db))return fn();
 contexts.set(db,new Map());
 try{return fn()}finally{contexts.delete(db)}
}
export function memoRead(db,namespace,args,load){
 const context=contexts.get(db);
 if(!context)return load();
 const key=JSON.stringify([namespace,args]);
 if(context.has(key))return context.get(key);
 const value=load();
 if(context.size<MAX)context.set(key,value);
 return value;
}
