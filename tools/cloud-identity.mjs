import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
// Amvera may reserialize its root YAML when the user saves Configuration.
// Only this exact, restricted LC8.1 recipe can be accepted in another
// formatting. This is deliberately NOT a general YAML parser: reject aliases,
// tags, duplicate/unknown fields, sequences, complex scalars and other modes.
const qaRecipePath='deploy/lc81-amvera/amvera.yml';
const qaFields=new Map([
 ['meta.environment','nodejs'],['meta.toolchain.name','npm'],['meta.toolchain.version',22],
 ['build.skip',false],['build.additionalCommands','node tools/build_folder.mjs --cloud'],['build.artifacts.*','/'],
 ['run.scriptName','server/lc81-main.mjs'],['run.containerPort',8080],['run.persistenceMount','/data'],
 ['run.scriptArguments',null],['run.nodeArguments',null],['run.command',null],['run.singleton',true],['run.zeroDowntime',false]
]);
const qaBlocks=new Set(['meta','meta.toolchain','build','build.artifacts','run']);
function qaRecipe(bytes){
 const stack=[{indent:-1,key:'',childIndent:0}],seen=new Set();let header=false;
 for(let line of new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/)){
  // The approved values contain no # characters. Inline comments
  // are allowed only after whitespace. Anything ambiguous fails closed.
  if(/^\s*(?:#.*)?$/.test(line))continue;
  if(/^--- *(?:#.*)?$/.test(line)){if(header||seen.size)return false;header=true;continue}
  line=line.replace(/ +#.*$/,'').replace(/ +$/,'');
  const m=/^( *)([A-Za-z][A-Za-z0-9]*|'\*'|"\*"):(?: +(.*))?$/.exec(line);
  if(!m)return false;
  const indent=m[1].length;while(stack.length>1&&indent<=stack.at(-1).indent)stack.pop();
  const parent=stack.at(-1);
  if(indent<=parent.indent||parent.childIndent!==undefined&&parent.childIndent!==indent)return false;
  parent.childIndent=indent;
  const name=m[2]==="'*'"||m[2]==='"*"'?'*':m[2];
  const key=parent.key?parent.key+'.'+name:name;
  if(seen.has(key))return false;seen.add(key);
  if(m[3]===undefined){
   if(!qaBlocks.has(key))return false;
   stack.push({indent,key,childIndent:undefined});continue;
  }
  if(!qaFields.has(key))return false;
  const expected=qaFields.get(key),raw=m[3];
  if(expected===null||typeof expected==='number'||typeof expected==='boolean'){if(raw!==String(expected))return false}
  else if(key==='meta.environment'&&['node',"'node'",'"node"'].includes(raw)){} // documented spelling also accepted
  else if(raw!==expected&&raw!=="'"+expected+"'"&&raw!=='"'+expected+'"')return false;
 }
 return seen.size===qaFields.size+qaBlocks.size&&[...qaFields.keys(),...qaBlocks].every(k=>seen.has(k));
}
function formattedQaRecipe(root,bytes,expectedSha){
 try{
  const canonical=fs.readFileSync(path.join(root,qaRecipePath));
  return gitBlob(canonical)===expectedSha&&qaRecipe(canonical)&&qaRecipe(bytes);
 }catch{return false}
}
// A metadata-only child pins the actual source commit, allowing exact
// diagnostics when Amvera builds without a .git directory.
export function cloudIdentity(root=process.cwd()){
 const pin=JSON.parse(fs.readFileSync(path.join(root,'tools/cloud-source.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(pin.sourceCommit)||!Array.isArray(pin.files)||!pin.files.length)throw Error('Invalid cloud source descriptor');
 const expected=new Map();
 for(const item of pin.files){if(typeof item.path!=='string'||item.path.split('/').some(x=>!x||x==='.'||x==='..')||! /^[a-f0-9]{40}$/.test(item.sha)||expected.has(item.path))throw Error('Invalid cloud source entry');expected.set(item.path,item.sha)}
 const actual=[];
 function walk(dir){for(const name of fs.readdirSync(path.join(root,dir)).sort()){const file=dir+'/'+name;if(file==='tools/cloud-source.json')continue;const s=fs.lstatSync(path.join(root,file));if(s.isDirectory())walk(file);else if(s.isFile())actual.push(file);else throw Error('Unsupported source entry '+file)}}
 for(const dir of ['src','server','db','tools'])walk(dir);
 actual.push('package.json','package-lock.json','amvera.yml','docs/DEPLOY_NETWORK_RU.md','baselines/sop-stage43/releases/stage43-sop-print-formats-20261125.html','baselines/sop-stage43/src/vendor/exceljs.min.js','baselines/sop-stage43/src/vendor/ExcelJS_LICENSE.txt');
 actual.sort();if(actual.length!==expected.size||actual.some(file=>!expected.has(file)))throw Error('Cloud source set changed');
 const hash=createHash('sha256');for(const file of actual){
  const bytes=fs.readFileSync(path.join(root,file)),sha=gitBlob(bytes),pinned=expected.get(file);
  if(sha!==pinned){
   if(file!=='amvera.yml'||!formattedQaRecipe(root,bytes,pinned))throw Error('Cloud source changed: '+file+' (expected '+pinned+', actual '+sha+')');
   console.log('LC8.1 Amvera recipe: approved equivalent YAML formatting; canonical '+pinned+', actual '+sha);
  }
  hash.update(file+'\0'+pinned+'\n');
 }
 return {sourceCommit:pin.sourceCommit,sourceFingerprint:hash.digest('hex')};
}
