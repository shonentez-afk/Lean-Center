// One replacement pass: the payload itself contains the generator's source excerpts.
export function renderAtlas(template,model,client){
 const payload=JSON.stringify(model).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const tokens={'/*__LC_ATLAS_DATA__*/':payload,'/*__LC_ATLAS_CLIENT__*/':client.replace(/<\/script/gi,'<\\/script')},seen=new Set();
 const html=template.replace(/\/\*__LC_ATLAS_(?:DATA|CLIENT)__\*\//g,key=>{if(seen.has(key))throw Error('Duplicate template marker '+key);seen.add(key);return tokens[key]});
 if(seen.size!==2)throw Error('Missing atlas template marker');return html
}
