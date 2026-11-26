import {parse} from 'acorn';
import path from 'node:path';
import {createHash} from 'node:crypto';

const posix=path.posix;
const childNodes=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end','range','type'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x&&typeof x.type==='string').map(x=>[k,x]):v&&typeof v.type==='string'?[[k,v]]:[]);
const names=p=>!p?[]:p.type==='Identifier'?[p.name]:p.type==='RestElement'?names(p.argument):p.type==='AssignmentPattern'?names(p.left):p.type==='ArrayPattern'?p.elements.flatMap(names):p.type==='ObjectPattern'?p.properties.flatMap(q=>names(q.type==='RestElement'?q.argument:q.value)):[];
const prop=n=>n?.type==='Identifier'?n.name:n?.type==='Literal'?String(n.value):null;
const fun=n=>n&&['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
const globals=new Set('Array Object String Number Boolean Date Math JSON Promise Map Set WeakMap WeakSet RegExp Error TypeError RangeError Symbol BigInt parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent atob btoa structuredClone setTimeout clearTimeout setInterval clearInterval queueMicrotask fetch alert confirm prompt requestAnimationFrame cancelAnimationFrame URL URLSearchParams TextEncoder TextDecoder Uint8Array ArrayBuffer Blob File FileReader AbortController MutationObserver ResizeObserver DOMParser CustomEvent Event Worker FormData Buffer console'.split(' '));
const scope=(parent,kind='block')=>({parent,kind,bindings:new Map()});
function find(s,name){for(;s;s=s.parent)if(s.bindings.has(name))return s.bindings.get(name);return null}
function put(s,name,value){if(name)s.bindings.set(name,value)}
function varScope(s){while(s.parent&&s.kind!=='function'&&s.kind!=='module')s=s.parent;return s}
const idFor=(file,n)=>file+'#'+n.start;
const groupOf=p=>p.startsWith('baselines/')?'Stage43 · исходный baseline':p.startsWith('tests/')?'Тесты':p.startsWith('tools/')?'Инструменты':p.startsWith('src/modules/')?p.split('/')[2]:p.startsWith('src/')?p.split('/')[1]:p.split('/')[0];
function sourceRef(file,n,text){return {file,line:n.loc.start.line,endLine:n.loc.end.line,excerpt:text.slice(n.start,Math.min(n.end,n.start+240)).replace(/\s+/g,' ')}}
function literal(n){if(n?.type==='Literal'&&typeof n.value==='string')return {text:n.value,partial:false};if(n?.type==='TemplateLiteral')return {text:n.quasis.map(q=>q.value.cooked??q.value.raw).join(' __DYNAMIC__ '),partial:n.expressions.length>0};return null}
export function sqlReferences(sql,tableNames){
 const clean=sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,' ').replace(/'(?:''|[^'])*'/g,"''");
 const tokens=clean.match(/"(?:""|[^"])*"|[\w$]+|[(),.;]/g)||[],out=[];
 const seen=new Set();
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i].toUpperCase();let mode=null,j=i+1;
  if(t==='FROM'||t==='JOIN')mode='sql-read';
  if(t==='DELETE'&&tokens[j]?.toUpperCase()==='FROM'){mode='sql-write';j++;i++}
  if(t==='INSERT'||t==='REPLACE'||t==='UPDATE'){
   mode='sql-write';if(tokens[j]?.toUpperCase()==='OR')j+=2;if(tokens[j]?.toUpperCase()==='INTO')j++;
   if(t==='UPDATE'&&tokens[j]?.toUpperCase()==='SET')mode=null;
  }
  if(!mode)continue;
  let name=(tokens[j]||'').replace(/^"|"$/g,'');if(tokens[j+1]==='.')name=(tokens[j+2]||'').replace(/^"|"$/g,'');
  const exact=tableNames.get(name.toLowerCase());
  if(!exact)continue;
  const key=mode+'|'+exact;if(!seen.has(key)){seen.add(key);out.push({mode,table:exact})}
 }
 return out
}
export function analyzeSources(sources,tables=[],{scriptFiles=[]}={}){
 const modules=new Map(),nodes=new Map(),edges=[],unresolved=[],sqlSites=[],errors=[],fileSet=new Set(Object.keys(sources)),scripts=new Set(scriptFiles);
 const tableNames=new Map(tables.map(t=>[t.name.toLowerCase(),t.name]));
 const addNode=x=>{if(!nodes.has(x.id))nodes.set(x.id,x);return nodes.get(x.id)};
 const addEdge=(from,to,kind,ref,extra={})=>edges.push({from,to,kind,...ref,...extra});
 for(const t of tables)addNode({id:'table:'+t.name,name:t.name,kind:'table',group:'SQLite',...t});
 for(const t of tables)for(const fk of t.foreignKeys||[])if(tableNames.has(fk.table.toLowerCase()))addEdge('table:'+t.name,'table:'+tableNames.get(fk.table.toLowerCase()),'foreign-key',{file:t.file||'',line:t.line||1,endLine:t.line||1,excerpt:fk.from+' → '+fk.to},{constraint:fk.id});
 const resolvePath=(from,s)=>{if(!s.startsWith('.'))return null;const p=posix.normalize(posix.join(posix.dirname(from),s));return [p,p+'.js',p+'.mjs',p+'/index.js'].find(x=>fileSet.has(x))||null};
 function external(name,kind='external'){return addNode({id:kind+':'+name,name,kind,group:'Внешняя граница'}).id}
 for(const file of Object.keys(sources).sort()){
  const text=sources[file],fileNode=addNode({id:file,name:posix.basename(file),file,line:1,endLine:text.split('\n').length,kind:'file',group:groupOf(file),sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
  let ast;try{ast=parse(text,{ecmaVersion:'latest',sourceType:scripts.has(file)?'script':'module',locations:true,allowHashBang:true})}catch(e){errors.push({file,line:e.loc?.line||1,message:e.message});continue}
  // Baseline scripts are parsed in isolation: concatenated global binding resolution needs separate validation against the pinned release.
  const root=scope(null,'module'),m={file,text,root,imports:[],exports:new Map(),calls:[],ast};modules.set(file,m);
  const ref=n=>sourceRef(file,n,text);
  function symbol(n,name,kind,owner){const id=idFor(file,n);addNode({id,name,kind,group:fileNode.group,...ref(n),owner});addEdge(owner,id,'contains',ref(n));return id}
  function visit(n,s,owner,parent=null,key='',cls=null,hint=null){
   if(n.type==='ImportDeclaration'){
    const spec=n.source.value,target=resolvePath(file,spec),dest=target||external(spec,spec.startsWith('.')?'missing-module':'external');
    addEdge(file,dest,'import',ref(n));m.imports.push({source:spec,target});
    for(const a of n.specifiers)put(s,a.local.name,{kind:'import',target,source:spec,name:a.type==='ImportDefaultSpecifier'?'default':a.type==='ImportNamespaceSpecifier'?'*':prop(a.imported)});
    return;
   }
   if(n.type==='ExportNamedDeclaration'){
    if(n.source){const target=resolvePath(file,n.source.value);addEdge(file,target||external(n.source.value,'external'),'reexport',ref(n));for(const a of n.specifiers)m.exports.set(prop(a.exported),{kind:'reexport',target,name:prop(a.local)});}
    else for(const a of n.specifiers)m.exports.set(prop(a.exported),{kind:'local',name:prop(a.local)});
    if(n.declaration){const d=n.declaration;for(const name of d.type==='VariableDeclaration'?d.declarations.flatMap(x=>names(x.id)):names(d.id))m.exports.set(name,{kind:'local',name});visit(d,s,owner,n,'declaration',cls)}
    return;
   }
   if(n.type==='ExportDefaultDeclaration'){
    const d=n.declaration;visit(d,s,owner,n,'declaration',cls,'default');m.exports.set('default',d.id?{kind:'local',name:d.id.name}:fun(d)||d.type==='ClassDeclaration'||d.type==='ClassExpression'?{kind:'symbol',id:idFor(file,d)}:{kind:'local',name:d.name});return
   }
   if(n.type==='ExportAllDeclaration'){const target=resolvePath(file,n.source.value);addEdge(file,target||external(n.source.value),'reexport-all',ref(n));return}
   if(n.type==='VariableDeclaration'){
    for(const d of n.declarations){const dest=n.kind==='var'?varScope(s):s,ns=names(d.id);for(const name of ns)put(dest,name,{kind:'value'});
     if(d.init){visit(d.init,s,owner,d,'init',cls,ns.length===1?ns[0]:null);if(ns.length===1&&(fun(d.init)||d.init.type==='ClassExpression'))put(dest,ns[0],{kind:'symbol',id:idFor(file,d.init)})}
     if(d.id.type!=='Identifier')visit(d.id,s,owner,d,'id',cls)
    }return
   }
   if(n.type==='ClassDeclaration'||n.type==='ClassExpression'){
    const name=n.id?.name||hint||'(class)',id=symbol(n,name,'class',owner),cs=scope(s,'class'),context={id,methods:new Map()};
    if(n.id)put(s,n.id.name,{kind:'symbol',id});
    for(const method of n.body.body)if(method.type==='MethodDefinition'&&!method.computed&&method.value)context.methods.set((method.static?'static:':'')+prop(method.key),idFor(file,method.value));
    if(n.superClass)visit(n.superClass,s,owner,n,'superClass',cls);
    for(const x of n.body.body)visit(x,cs,id,n.body,'body',context);return
   }
   if(fun(n)){
    const name=n.id?.name||hint||(parent?.type==='MethodDefinition'||parent?.type==='Property'?prop(parent.key):null)||'(callback '+n.loc.start.line+':'+n.loc.start.column+')';
    const id=symbol(n,name,parent?.type==='MethodDefinition'?'method':'function',owner);
    if(n.type==='FunctionDeclaration'&&n.id)put(s,n.id.name,{kind:'symbol',id});
    const fs=scope(s,'function');if(n.id)put(fs,n.id.name,{kind:'symbol',id});for(const p of n.params)for(const name of names(p))put(fs,name,{kind:'parameter'});
    const cc=parent?.type==='MethodDefinition'?{...cls,static:parent.static}:n.type==='ArrowFunctionExpression'?cls:null;
    for(const p of n.params)visit(p,fs,id,n,'params',cc);
    visit(n.body,fs,id,n,'body',cc);return
   }
   if(n.type==='BlockStatement'||n.type==='SwitchStatement'||n.type==='ForStatement'||n.type==='ForInStatement'||n.type==='ForOfStatement'||n.type==='CatchClause'){
    s=scope(s);if(n.type==='CatchClause')for(const name of names(n.param))put(s,name,{kind:'parameter'});
   }
   if(n.type==='CallExpression'||n.type==='NewExpression')m.calls.push({n,s,owner,cls});
   if(n.type==='ImportExpression'){const a=literal(n.source);if(a&&!a.partial){const target=resolvePath(file,a.text);addEdge(owner,target||external(a.text),'dynamic-import-literal',ref(n))}else unresolved.push({owner,reason:'dynamic-import',...ref(n)})}
   for(const [k,ch] of childNodes(n))visit(ch,s,owner,n,k,cls);
  }
  visit(ast,root,file);
 }
 function resolveBinding(b,visited=new Set()){
  if(!b)return null;if(b.kind==='symbol')return b.id;
  if(b.kind==='import'||b.kind==='reexport'){
   if(!b.target)return b.source&&!b.source.startsWith('.')?external(b.source+'::'+b.name):null;
   const key=b.target+'::'+b.name;if(visited.has(key))return null;visited.add(key);
   const m=modules.get(b.target),e=m?.exports.get(b.name);if(!e)return null;
   return resolveBinding(e.kind==='local'?find(m.root,e.name):e,visited)
  }
  return null
 }
 for(const m of modules.values()){
  for(const [name,b] of m.exports){const id=resolveBinding(b.kind==='local'?find(m.root,b.name):b);if(id)addEdge(m.file,id,'export',{file:m.file,line:nodes.get(id)?.line||1,endLine:nodes.get(id)?.line||1,excerpt:'export '+name})}
  for(const {n,s,owner,cls} of m.calls){
   let c=n.callee;if(c?.type==='ChainExpression')c=c.expression;
   let target=null,reason='dynamic-callee',name=m.text.slice(c.start,Math.min(c.end,c.start+120));
   if(c.type==='Identifier'){
    const b=find(s,c.name);target=resolveBinding(b);reason=b?'binding-not-callable-statically':'global-or-script-dynamic';
    if(!b&&globals.has(c.name)&&!scripts.has(m.file))target=external(c.name,'runtime');
   }else if(c.type==='MemberExpression'&&!c.computed){
    const k=prop(c.property),b=c.object.type==='Identifier'?find(s,c.object.name):null;
    if(b?.kind==='import'&&b.name==='*')target=resolveBinding({...b,name:k});
    if(c.object.type==='ThisExpression'&&cls)target=cls.methods.get((cls.static?'static:':'')+k)||null;
    reason='receiver-not-proven';
   }else if(fun(c))target=idFor(m.file,c);
   const ref=sourceRef(m.file,n,m.text);
   if(target&&nodes.has(target))addEdge(owner,target,n.type==='NewExpression'?'construct':'call',ref);
   else unresolved.push({owner,name,reason,...ref});
   // SQL references: exact table literals, not inferred query execution. Dynamic expressions stay explicit.
   const coreQuery=!!target&&target.startsWith('src/core/db.js#')&&['rows','one'].includes(nodes.get(target)?.name);
   const sqlArg=coreQuery?1:c.type==='MemberExpression'&&['run','exec','prepare'].includes(prop(c.property))?0:-1;
   if(sqlArg>=0){
    const q=literal(n.arguments[sqlArg]),core=coreQuery,certainty=core?'core-query-literal':'receiver-unproven';
    if(q&&/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE|PRAGMA|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK)\b/i.test(q.text)){
     const refs=sqlReferences(q.text,tableNames);
     sqlSites.push({owner,...ref,sql:q.text.slice(0,1000),partial:q.partial,certainty,tables:refs});
     for(const x of refs)addEdge(owner,'table:'+x.table,x.mode,ref,{certainty,partial:q.partial});
    }else if(!q&&(core||c.type==='MemberExpression'&&c.object.type==='Identifier'&&c.object.name==='db'))sqlSites.push({owner,...ref,sql:null,partial:true,certainty:'dynamic-sql',tables:[]});
   }
  }
 }
 return {nodes:[...nodes.values()],edges,unresolved,sqlSites,errors,files:Object.keys(sources).sort()}
}
