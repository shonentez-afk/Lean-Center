import {Script} from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';
import {buildEditor} from './build_editor.mjs';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const version='lc6.7.5-standard-dev';
const output=path.join(root,'dist','LeanCenter');
const releasePath='versions/'+version;
const files=new Map();
const put=(name,content)=>{if(files.has(name))throw Error('Duplicate file '+name);files.set(name,Buffer.isBuffer(content)?content:Buffer.from(content,'utf8'))};
const code=(name,content)=>{new Script(content,{filename:name});put(releasePath+'/'+name,content)};
const js=buildSync({entryPoints:['src/app.js'],bundle:true,platform:'browser',format:'iife',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const settings={schema:read('db/schema_v1.sql'),migration:read('db/migrations/002_lc1.sql'),migration3:read('db/migrations/003_lc2.sql'),migration4:read('db/migrations/004_lc3.sql'),migration5:read('db/migrations/005_lc3_requirements.sql'),migration6:read('db/migrations/006_stage43_checklist.sql'),migration7:read('db/migrations/007_lc4_training.sql'),migration8:read('db/migrations/008_lc4_corporate_forms.sql'),migration9:read('db/migrations/009_lc42_methods.sql'),migration10:read('db/migrations/010_lc43_matrix.sql'),migration11:read('db/migrations/011_lc5_audit.sql'),migration12:read('db/migrations/012_lc51_assessments.sql'),migration13:read('db/migrations/013_lc52_integration.sql'),migration14:read('db/migrations/014_lc6_effect.sql'),migration15:read('db/migrations/015_lc63_twi_standard.sql'),migration16:read('db/migrations/016_lc64_twi_workflows.sql'),migration17:read('db/migrations/017_lc65_preparation_results.sql'),version};
code('app/config.js','window.LC_BUILD='+JSON.stringify(settings)+';\n');
code('vendor/sql-wasm-data.js','window.LC_BUILD.wasm='+JSON.stringify(fs.readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64'))+';\n');
code('vendor/sql-wasm.js',read('node_modules/sql.js/dist/sql-wasm.js'));
code('vendor/echarts.min.js',read('node_modules/echarts/dist/echarts.min.js'));
code('vendor/exceljs.min.js',read('baselines/sop-stage43/src/vendor/exceljs.min.js'));
put(releasePath+'/licenses/exceljs/LICENSE.txt',read('baselines/sop-stage43/src/vendor/ExcelJS_LICENSE.txt'));
code('app/main.js',js);
const picker=buildSync({entryPoints:['src/ui/people-picker.js'],bundle:true,platform:'browser',format:'iife',globalName:'LCPeoplePicker',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const linked=buildSync({entryPoints:['src/modules/library/linked-materials.js'],bundle:true,platform:'browser',format:'iife',globalName:'LCLinkedMaterials',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const bridge=picker+'\n'+linked+'\n'+read('src/modules/library/lean-bridge.js');new Script(bridge,{filename:'lean-bridge.js'});
code('editor/Stage43-data.js','window.LC_EDITOR_HTML='+JSON.stringify(buildEditor(bridge,read('src/ui/editor.css')+'\n'+read('src/ui/people-picker.css')))+';\n');
put(releasePath+'/assets/styles.css',read('src/ui/styles.css')+'\n'+read('src/ui/people-picker.css'));
for(const name of ['sql.js','echarts','zrender','tslib']){
 const dir=path.join(root,'node_modules',name);
 if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).sort())if(/^(LICENSE|NOTICE|COPYING)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile())put(releasePath+'/licenses/'+name+'/'+file,fs.readFileSync(path.join(dir,file)));
}
const entry=read('src/ui/folder.html').replaceAll('__LC_RELEASE__',releasePath);
put('index.html',entry);
put('README_DEPLOY_RU.txt',read('docs/DEPLOY_NETWORK_RU.md'));
const manifest={format:1,version,entry:'index.html',files:[...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
put('app-manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Only build in the dedicated local dist directory. No data or backups are deployed.
if(fs.existsSync(output))fs.rmSync(output,{recursive:true,force:true});
for(const [name,bytes] of files){const dest=path.join(output,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes)}
console.log('LC1 folder build',version,files.size,'files',[...files.values()].reduce((sum,b)=>sum+b.length,0),'bytes');
