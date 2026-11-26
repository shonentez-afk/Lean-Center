// Actual domain and navigation inventory. Not a security audit or a grant.
import fs from 'node:fs/promises';
import {parse} from 'acorn';
import {pilotSql} from '../server/lc74-store.mjs';
import {createDb,definitions,rows} from '../src/core/db.js';
import {DOMAIN_TYPES} from '../src/modules/library/domain.js';
import {READ_ACTIONS,RESOURCE_TABLES,REFERENCE_CREATE_TYPES,COMMAND_ACTIONS} from '../server/lc81/access-contract.mjs';
const {SQL,schema,migration}=await pilotSql(),db=createDb(SQL,schema,migration);
try{
 const source=await fs.readFile('src/app.js','utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const nav=ast.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).find(n=>n.id.name==='navGroups')?.init;
 if(nav?.type!=='ArrayExpression')throw Error('Missing navGroups');
 const pageSupport={person:'person.read_basic',sop:'sop.read_effective',twi:'training.read',actions:'task.read'};
 const sections=nav.elements.map(g=>({group:g.elements[0].value,pages:g.elements[1].elements.map(p=>({id:p.value,qa:p.value==='person'?'basic metadata only':pageSupport[p.value]?'limited projection only':'not connected; deny'}))}));
 const entities=[...new Set([...Object.keys(definitions),...Object.keys(DOMAIN_TYPES)])].sort().map(type=>({type,qaCreate:REFERENCE_CREATE_TYPES.includes(type)?'bootstrap admin only; synthetic reference':'denied',qaUpdate:type==='action_item'?'task.implement_own only; server owner and domain checks':'denied',qaArchive:'denied'}));
 const tables=rows(db,"SELECT name,type FROM sqlite_master WHERE type IN('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t=>({...t,qaDirectAccess:'denied'}));
 for(const t of REFERENCE_CREATE_TYPES)if(!Object.hasOwn(definitions,t))throw Error('Missing existing directory '+t);
 for(const t of Object.values(RESOURCE_TABLES))if(!tables.some(x=>x.name===t))throw Error('Missing projection table '+t);
 const inventory={mode:'LC8.1 QA, default deny',readActions:READ_ACTIONS,commandActions:COMMAND_ACTIONS,counts:{pages:sections.reduce((n,g)=>n+g.pages.length,0),eventTypes:entities.length,tablesAndViews:tables.length},sections,entities,tables};
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/lc81-access-inventory.json',JSON.stringify(inventory,null,2)+'\n');
 console.log('LC8.1 inventory '+JSON.stringify(inventory.counts));
}finally{db.close()}
