import fs from 'node:fs';import path from 'node:path';import {buildSync} from 'esbuild';
const root=process.cwd(),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const js=buildSync({entryPoints:['src/app.js'],bundle:true,platform:'browser',format:'iife',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const safe=s=>s.replace(/<\/script/gi,'<\\/script');const script=s=>'<script>'+safe(s)+'</script>';
const settings={schema:read('db/schema_v1.sql'),migration:read('db/migrations/002_lc1.sql'),wasm:fs.readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64')};
const license=read('node_modules/sql.js/LICENSE')+'\n'+read('node_modules/echarts/LICENSE');
const scripts=script('window.LC_BUILD='+JSON.stringify(settings).replace(/</g,'\\u003c')+';')+script(read('node_modules/sql.js/dist/sql-wasm.js'))+script(read('node_modules/echarts/dist/echarts.min.js'))+script(js);
const html=read('src/ui/index.html').replace('__LC_CSS__',()=>read('src/ui/styles.css')).replace('__LC_SCRIPTS__',()=>scripts).replace('</body>','<!-- Third-party licenses\n'+license.replace(/--/g,'- -')+'\n--></body>');
fs.mkdirSync('releases',{recursive:true});fs.writeFileSync('releases/LeanCenter-LC1.html',html);console.log('LC1 standalone',Buffer.byteLength(html),'bytes');
