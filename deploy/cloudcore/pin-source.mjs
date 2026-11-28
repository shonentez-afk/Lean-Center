import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const sourceCommit=git('rev-parse','HEAD').trim();
if(!/^[a-f0-9]{40}$/.test(sourceCommit)||sourceCommit!==process.env.GITHUB_SHA){
  throw new Error('Unexpected CloudCore source revision');
}
const sourcePaths=[
  'src','server','db','tools','package.json','package-lock.json','amvera.yml',
  'docs/DEPLOY_NETWORK_RU.md',
  'baselines/sop-stage43/releases/stage43-sop-print-formats-20261125.html',
  'baselines/sop-stage43/src/vendor/exceljs.min.js',
  'baselines/sop-stage43/src/vendor/ExcelJS_LICENSE.txt'
];
const entries=git('ls-tree','-r','-z',sourceCommit,'--',...sourcePaths).split('\0').filter(Boolean);
const files=entries.map(entry=>{
  const tab=entry.indexOf('\t');
  const [mode,type,sha]=entry.slice(0,tab).split(' ');
  const path=entry.slice(tab+1);
  if(tab<0||!['100644','100755'].includes(mode)||type!=='blob'||! /^[a-f0-9]{40}$/.test(sha)){
    throw new Error('Unsupported CloudCore source entry');
  }
  return {path,sha};
}).filter(file=>file.path!=='tools/cloud-source.json');
if(!files.length) throw new Error('CloudCore source list is empty');
files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
writeFileSync('tools/cloud-source.json',JSON.stringify({sourceCommit,files},null,2)+'\n');
