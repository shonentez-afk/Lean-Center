import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
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
 const hash=createHash('sha256');for(const file of actual){const bytes=fs.readFileSync(path.join(root,file));const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');if(sha!==expected.get(file))throw Error('Cloud source changed: '+file);hash.update(file+'\0'+sha+'\n')}
 return {sourceCommit:pin.sourceCommit,sourceFingerprint:hash.digest('hex')};
}
