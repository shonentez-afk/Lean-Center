import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
// Amvera may reserialize its root YAML when the user saves Configuration.
// Only this exact, restricted LC8.1 recipe can be accepted in another
// formatting. This is deliberately NOT a general YAML parser: reject aliases,
// tags, duplicate/unknown fields, sequences, complex scalars and other modes.
const qaRecipePath='deploy/lc81-amvera/amvera.yml';
const qaLockPath='tools/lc81-amvera-package-lock.json';
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
export function cloudIdentity(root=process.cwd(),{restoreNpmLock=false}={}){
 const pin=JSON.parse(fs.readFileSync(path.join(root,'tools/cloud-source.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(pin.sourceCommit)||!Array.isArray(pin.files)||!pin.files.length)throw Error('Invalid cloud source descriptor');
 const expected=new Map();
 for(const item of pin.files){if(typeof item.path!=='string'||item.path.split('/').some(x=>!x||x==='.'||x==='..')||! /^[a-f0-9]{40}$/.test(item.sha)||expected.has(item.path))throw Error('Invalid cloud source entry');expected.set(item.path,item.sha)}
 // In the protected deployment branch only, a pinned copy is the
 // authority for the npm lock. The platform's rewritten lock is never
 // trusted as an alternative dependency graph. Verify the whole tree before
 // restoring anything. Normal identity checks remain strict.
 let recovery=null,replacement=null;
 if(restoreNpmLock&&expected.has(qaLockPath)){
  const source=path.join(root,qaLockPath),recipe=path.join(root,qaRecipePath),target=path.join(root,'package-lock.json');
  if(!fs.lstatSync(source).isFile()||!fs.lstatSync(recipe).isFile()||!fs.lstatSync(target).isFile())throw Error('Unsupported LC8.1 deployment source entry');
  const canonical=fs.readFileSync(source),yaml=fs.readFileSync(recipe);
  if(expected.get(qaLockPath)!==expected.get('package-lock.json')||gitBlob(canonical)!==expected.get(qaLockPath)||gitBlob(yaml)!==expected.get('amvera.yml')||!qaRecipe(yaml))throw Error('Unverified LC8.1 canonical npm lock or recipe');
  recovery=canonical;
 }
 const actual=[];
 function walk(dir){for(const name of fs.readdirSync(path.join(root,dir)).sort()){const file=dir+'/'+name;if(file==='tools/cloud-source.json')continue;const s=fs.lstatSync(path.join(root,file));if(s.isDirectory())walk(file);else if(s.isFile())actual.push(file);else throw Error('Unsupported source entry '+file)}}
 for(const dir of ['src','server','db','tools'])walk(dir);
 actual.push('package.json','package-lock.json','amvera.yml','docs/DEPLOY_NETWORK_RU.md','baselines/sop-stage43/releases/stage43-sop-print-formats-20261125.html','baselines/sop-stage43/src/vendor/exceljs.min.js','baselines/sop-stage43/src/vendor/ExcelJS_LICENSE.txt');
 actual.sort();if(actual.length!==expected.size||actual.some(file=>!expected.has(file)))throw Error('Cloud source set changed');
 const hash=createHash('sha256');for(const file of actual){
  const bytes=fs.readFileSync(path.join(root,file)),sha=gitBlob(bytes),pinned=expected.get(file);
  if(sha!==pinned){
   if(file==='package-lock.json'&&recovery){
    replacement={bytes:recovery,actual:sha,pinned};
   }else{
    if(file!=='amvera.yml'||!formattedQaRecipe(root,bytes,pinned))throw Error('Cloud source changed: '+file+' (expected '+pinned+', actual '+sha+')');
    console.log('LC8.1 Amvera recipe: approved equivalent YAML formatting; canonical '+pinned+', actual '+sha);
   }
  }
  hash.update(file+'\0'+pinned+'\n');
 }
 if(replacement){
  const target=path.join(root,'package-lock.json');
  fs.writeFileSync(target,replacement.bytes);
  if(gitBlob(fs.readFileSync(target))!==replacement.pinned)throw Error('LC8.1 npm lock restoration failed');
  console.log('LC8.1 Amvera npm lock restored: platform '+replacement.actual+', canonical '+replacement.pinned);
 }
 return {sourceCommit:pin.sourceCommit,sourceFingerprint:hash.digest('hex')};
}
// Call before loading esbuild or any other npm dependency. In this isolated
// branch Amvera has already run its own install. Replace that installation
// with npm ci from the verified, exact lock, including build/optional deps.
// The strict identity check after installation proves npm ci did not mutate
// any pinned files. Other cloud/desktop branches keep their previous behavior.
export function prepareCloudBuild(root=process.cwd()){
 if(!fs.existsSync(path.join(root,qaLockPath)))return cloudIdentity(root);
 const before=cloudIdentity(root,{restoreNpmLock:true});
 execFileSync('npm',['ci','--ignore-scripts','--include=dev','--include=optional','--package-lock=true','--no-audit','--no-fund'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
 const after=cloudIdentity(root);
 if(before.sourceCommit!==after.sourceCommit||before.sourceFingerprint!==after.sourceFingerprint)throw Error('LC8.1 source identity changed during dependency installation');
 console.log('LC8.1 Amvera npm ci verified against canonical lock');
 return after;
}
