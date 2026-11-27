import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {buildEmbeddedEditor} from '../../tools/build_editor.mjs';
import {isId} from '../../src/core/primitives.js';
import {PilotError} from '../lc74-store.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
let template=null;
const marker='window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */';
export function editorFrame(session,kind,tab,editorAiEnabled=false){
 if(!isId(session)||!['sop','frv'].includes(kind)||!(tab===null||kind==='sop'&&['twi','frv'].includes(tab)))throw new PilotError(400,'Неверный редактор');
 if(!template){
  const read=p=>fs.readFileSync(root+p,'utf8');
  const runtime=buildEmbeddedEditor(read,{checkout:true});
  const memory=buildSync({entryPoints:[root+'server/lc81/editor-memory.js'],bundle:true,platform:'browser',format:'iife',target:'es2022',write:false}).outputFiles[0].text;
  if(runtime.split(marker).length!==2)throw Error('Editor context marker missing');
  // All bootstrap code is fixed source. Never interpolate a document into HTML.
  // The HTTP sandbox CSP independently prohibits external requests and storage.
  template=runtime.replace('<script>'+marker+'</script>',()=>'<script>'+memory.replace(/<\/script/gi,'<\\/script')+'</script><script>'+marker+'</script>');
  if(template===runtime)throw Error('Editor memory bootstrap marker missing');
 }
 const context={session,kind,tab,draftKey:null,cloudPilot:true,cloudAiEnabled:editorAiEnabled===true,protectedMemory:true};
 return Buffer.from(template.replace(marker,()=> 'window.LC_EDITOR_CONTEXT='+JSON.stringify(context)+';/* LC_EMBED_CONTEXT */'),'utf8');
}
