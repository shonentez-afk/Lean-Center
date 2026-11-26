import {Script} from 'node:vm';
import {createHash} from 'node:crypto';
export const DERIVED_FILE='generated/Stage43-derived-runtime.js';
export const DERIVED_VIEW='generated/Stage43-derived-source.html';
const hash=s=>createHash('sha256').update(s).digest('hex');
// The three classic scripts share the browser's global environment. Analyse
// a synthetic concatenation only; vendors, HTML handlers and runtime order
// are not assumed. Line references point at the generated offline source.
export function extractDerivedRuntime(html){
 const blocks=[...html.matchAll(/<script(?:\s[^>]*?)?>([\s\S]*?)<\/script\s*>/gi)];
 const selectors=[['context',s=>s.includes('window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */')],['stage43',s=>s.includes('const DRAFT_KEY=')&&s.includes('initDocumentManager();')],['adapter',s=>s.includes('host.LCSopRecovery(window,session,op,token,text)')]];
 let source='',previous=-1;const segments=[];
 for(const [name,predicate] of selectors){
  const selected=blocks.filter(x=>predicate(x[1]));
  if(selected.length!==1||selected[0].index<=previous)throw Error('Unexpected derived script '+name+': '+selected.length);
  const x=selected[0];previous=x.index;new Script(x[1],{filename:name});
  source+='// --- '+name+' ---\n';const from=source.split('\n').length;
  source+=x[1];const to=source.split('\n').length;
  segments.push({name,from,to,htmlLine:html.slice(0,x.index+x[0].indexOf('>')+1).split('\n').length,sha256:hash(x[1])});
  source+='\n;\n';
 }
 new Script(source,{filename:DERIVED_FILE});
 return {source,segments,sha256:hash(source),htmlSha256:hash(html)}
}
export function derivedSourceViewer(source){
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stage43 · сборный runtime</title><style>body{font:14px monospace;margin:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}span{display:block;scroll-margin-top:20px}span:target{background:#ffed9a}a{display:inline-block;min-width:6em;color:#456;text-decoration:none}</style><h1>Stage43 · сборный runtime</h1><p>Синтетический исходник из трёх фактических script-блоков сборки. Номера строк соответствуют атласу, а не GitHub HTML.</p><pre>'+source.split('\n').map((line,i)=>'<span id="L'+(i+1)+'"><a href="#L'+(i+1)+'">'+(i+1)+'</a>'+esc(line)+'</span>').join('\n')+'</pre></html>'
}
