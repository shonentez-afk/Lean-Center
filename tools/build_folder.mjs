import {Script} from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const version='lc1.2';
const output=path.join(root,'dist','LeanCenter');
const releasePath='versions/'+version;
const files=new Map();
const put=(name,content)=>{if(files.has(name))throw Error('Duplicate file '+name);files.set(name,Buffer.isBuffer(content)?content:Buffer.from(content,'utf8'))};
const code=(name,content)=>{new Script(content,{filename:name});put(releasePath+'/'+name,content)};
const js=buildSync({entryPoints:['src/app.js'],bundle:true,platform:'browser',format:'iife',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const settings={schema:read('db/schema_v1.sql'),migration:read('db/migrations/002_lc1.sql'),version};
code('app/config.js','window.LC_BUILD='+JSON.stringify(settings)+';\n');
code('vendor/sql-wasm-data.js','window.LC_BUILD.wasm='+JSON.stringify(fs.readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64'))+';\n');
code('vendor/sql-wasm.js',read('node_modules/sql.js/dist/sql-wasm.js'));
code('vendor/echarts.min.js',read('node_modules/echarts/dist/echarts.min.js'));
code('app/main.js',js);
put(releasePath+'/assets/styles.css',read('src/ui/styles.css'));
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
