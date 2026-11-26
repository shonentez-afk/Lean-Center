import {Script} from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';
import {buildEmbeddedEditor} from './build_editor.mjs';
import {CLOUD_RELEASE,CLOUD_BUILD_VERSION} from '../src/core/cloud-release.js';
import {cloudIdentity} from './cloud-identity.mjs';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const cloudPilot=process.argv.includes('--cloud');
const version=cloudPilot?CLOUD_BUILD_VERSION:'lc7.3b-standard-dev';
const identity=cloudPilot?cloudIdentity(root):null;
const output=path.join(root,'dist',cloudPilot?'LeanCenterCloud':'LeanCenter');
const releasePath='versions/'+version;
const files=new Map();
const put=(name,content)=>{if(files.has(name))throw Error('Duplicate file '+name);files.set(name,Buffer.isBuffer(content)?content:Buffer.from(content,'utf8'))};
const code=(name,content)=>{new Script(content,{filename:name});put(releasePath+'/'+name,content)};
const js=buildSync({entryPoints:['src/app.js'],bundle:true,platform:'browser',format:'iife',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const settings={schema:read('db/schema_v1.sql'),migration:read('db/migrations/002_lc1.sql'),migration3:read('db/migrations/003_lc2.sql'),migration4:read('db/migrations/004_lc3.sql'),migration5:read('db/migrations/005_lc3_requirements.sql'),migration6:read('db/migrations/006_stage43_checklist.sql'),migration7:read('db/migrations/007_lc4_training.sql'),migration8:read('db/migrations/008_lc4_corporate_forms.sql'),migration9:read('db/migrations/009_lc42_methods.sql'),migration10:read('db/migrations/010_lc43_matrix.sql'),migration11:read('db/migrations/011_lc5_audit.sql'),migration12:read('db/migrations/012_lc51_assessments.sql'),migration13:read('db/migrations/013_lc52_integration.sql'),migration14:read('db/migrations/014_lc6_effect.sql'),migration15:read('db/migrations/015_lc63_twi_standard.sql'),migration16:read('db/migrations/016_lc64_twi_workflows.sql'),migration17:read('db/migrations/017_lc65_preparation_results.sql'),version,...(cloudPilot?{cloudPilot:true,cloudRelease:CLOUD_RELEASE,...identity}:{})};
code('app/config.js','window.LC_BUILD='+JSON.stringify(settings)+';\n');
code('vendor/sql-wasm-data.js','window.LC_BUILD.wasm='+JSON.stringify(fs.readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64'))+';\n');
code('vendor/sql-wasm.js',read('node_modules/sql.js/dist/sql-wasm.js'));
code('vendor/echarts.min.js',read('node_modules/echarts/dist/echarts.min.js'));
code('vendor/exceljs.min.js',read('baselines/sop-stage43/src/vendor/exceljs.min.js'));
put(releasePath+'/licenses/exceljs/LICENSE.txt',read('baselines/sop-stage43/src/vendor/ExcelJS_LICENSE.txt'));
code('app/main.js',js);
code('editor/Stage43-data.js','window.LC_EDITOR_HTML='+JSON.stringify(buildEmbeddedEditor(read,{checkout:cloudPilot}))+';\n');
put(releasePath+'/assets/styles.css',read('src/ui/styles.css')+'\n'+read('src/ui/people-picker.css')+(cloudPilot?'\n'+read('src/ui/cloud-pilot.css'):''));
// Copy only the four local brand assets; preserve the supplied logo bytes.
for(const name of ['twi-workplace.webp','tn-two-line-light.svg','tn-two-line-dark.svg','favicon.png'])put(releasePath+'/assets/'+name,fs.readFileSync(path.join(root,'src/ui/brand',name)));
for(const name of ['sql.js','echarts','zrender','tslib']){
 const dir=path.join(root,'node_modules',name);
 if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).sort())if(/^(LICENSE|NOTICE|COPYING)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile())put(releasePath+'/licenses/'+name+'/'+file,fs.readFileSync(path.join(dir,file)));
}
// Windows shortcut icon: two PNG-backed sizes; all bytes covered by deployment manifest.
const icons=[{size:32,bytes:fs.readFileSync(path.join(root,'src/ui/brand/favicon-32.png'))},{size:64,bytes:fs.readFileSync(path.join(root,'src/ui/brand/favicon.png'))}];
const icoHeader=Buffer.alloc(6+16*icons.length);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(icons.length,4);
let icoOffset=icoHeader.length;
for(let i=0;i<icons.length;i++){const {size,bytes}=icons[i],at=6+16*i;
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size)throw Error('Invalid shortcut icon raster '+size);
 icoHeader[at]=size;icoHeader[at+1]=size;icoHeader.writeUInt16LE(1,at+4);icoHeader.writeUInt16LE(32,at+6);icoHeader.writeUInt32LE(bytes.length,at+8);icoHeader.writeUInt32LE(icoOffset,at+12);icoOffset+=bytes.length
}
put('LeanCenter.ico',Buffer.concat([icoHeader,...icons.map(x=>x.bytes)]));
const entry=read('src/ui/folder.html').replaceAll('__LC_RELEASE__',releasePath);
put('index.html',entry);
put('README_DEPLOY_RU.txt',read('docs/DEPLOY_NETWORK_RU.md'));
const manifest={format:1,version,...(cloudPilot?{release:CLOUD_RELEASE,...identity}:{}),entry:'index.html',files:[...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
put('app-manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Only build in the dedicated local dist directory. No data or backups are deployed.
if(fs.existsSync(output))fs.rmSync(output,{recursive:true,force:true});
for(const [name,bytes] of files){const dest=path.join(output,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes)}
if(identity)console.log('Cloud source identity',JSON.stringify(identity));
console.log('LC1 folder build',version,files.size,'files',[...files.values()].reduce((sum,b)=>sum+b.length,0),'bytes');
