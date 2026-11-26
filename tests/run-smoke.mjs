// Execute every independent smoke case even after failures. Never suppress a failed suite.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const cases=[
 ['LC1','tests/lc1-folder-browser.mjs'],['LC7.3B network recovery','tests/lc73b-network-browser.mjs'],['LC7.1 assistant','tests/lc7-browser.mjs'],['LC7.2 context','tests/lc72-browser.mjs'],['LC7.3A dashboard and metrics','tests/lc73-browser.mjs'],['LC6.7.4 resilience','tests/lc674-browser.mjs'],['LC6.7.5 work forms','tests/lc675-browser.mjs'],['LC2','tests/lc2-browser.mjs'],['LC3','tests/lc3-browser.mjs'],['LC4','tests/lc4-browser.mjs'],['RC1 mobile','tests/lc53-mobile-browser.mjs'],['LC6 ROI','tests/lc6-browser.mjs'],['LC6.4 preparation','tests/lc64-browser.mjs'],
 ...['classic','special','smed','hazardous','fractional','forms','commission'].map(x=>['LC6.7 '+x,'tests/lc67-browser.mjs',x])
];
const results=[];
for(const [name,...args] of cases){
 console.log('\n=== SMOKE START: '+name+' ===');
 const start=Date.now(),r=spawnSync(process.execPath,args,{stdio:'inherit',timeout:180000});
 const ok=r.status===0&&!r.error;results.push({name,ok,exit:r.status,seconds:Math.round((Date.now()-start)/1000)});
 if(r.error)console.error(r.error.message);
 console.log('=== SMOKE '+(ok?'PASS':'FAIL')+': '+name+' ===')
}
console.log('\n=== SMOKE SUMMARY ===');for(const r of results)console.log((r.ok?'PASS':'FAIL')+' '+r.name+' ('+r.seconds+' s, exit '+r.exit+')');
console.log(results.filter(r=>r.ok).length+'/'+results.length+' smoke cases passed');
fs.mkdirSync('artifacts/lc73b-runtime',{recursive:true});fs.writeFileSync('artifacts/lc73b-runtime/smoke-results.json',JSON.stringify({sha:process.env.GITHUB_SHA||null,platform:process.platform,total:results.length,passed:results.filter(r=>r.ok).length,cases:results},null,2)+'\n');
if(results.some(r=>!r.ok))process.exitCode=1;
