// Classification is deliberately descriptive, never an inferred call target.
export function unresolvedScope(file){
 if(file.startsWith('src/'))return 'product';
 if(file.startsWith('tests/'))return 'tests';
 if(file.startsWith('tools/'))return 'tools';
 if(file.startsWith('generated/'))return 'derived';
 if(file.startsWith('baselines/'))return 'baseline';
 return 'other'
}
export function summarizeUnresolved(records){
 const map=new Map(),byFile=new Map();
 for(const x of records){const scope=unresolvedScope(x.file),key=scope+'|'+x.reason;
  if(!map.has(key))map.set(key,{scope,reason:x.reason,count:0});map.get(key).count++;
  if(!byFile.has(x.file))byFile.set(x.file,{scope,file:x.file,count:0});byFile.get(x.file).count++
 }
 return {total:records.length,byReason:[...map.values()].sort((a,b)=>a.scope.localeCompare(b.scope)||b.count-a.count||a.reason.localeCompare(b.reason)),byFile:[...byFile.values()].sort((a,b)=>b.count-a.count||a.file.localeCompare(b.file))}
}
