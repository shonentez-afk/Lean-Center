import assert from 'node:assert/strict';
export function guardProbe(page){
 const probe={allow:true,events:[]};
 page.on('dialog',d=>{
  const guard=d.type()==='beforeunload'||d.type()==='confirm'&&d.message().includes('несохранённые изменения');
  if(guard)probe.events.push({type:d.type(),text:d.message()});
  return !guard||probe.allow?d.accept():d.dismiss()
 });
 return probe
}
export async function refusedLeave(probe,fn){
 const count=probe.events.length;probe.allow=false;await fn();assert.equal(probe.events.length,count+1,'Expected an unsaved-form warning')
}
// Reproduce menu, Back and F5 with a real, already populated nested editor.
export async function nestedGuard(page,probe,nav,read,expected){
 probe.allow=false;await refusedLeave(probe,()=>nav('Дашборд'));assert.deepEqual(await read(),expected);
 await refusedLeave(probe,()=>page.getByRole('button',{name:'← Назад',exact:true}).click());assert.deepEqual(await read(),expected);
 const routeId=await page.evaluate(()=>history.state.lcNav);
 let dialog=page.waitForEvent('dialog');await page.evaluate(()=>{history.back()});assert.equal((await dialog).type(),'confirm');
 await page.waitForFunction(id=>history.state.lcNav===id,routeId);assert.deepEqual(await read(),expected);
 dialog=page.waitForEvent('dialog');await page.evaluate(()=>{setTimeout(()=>location.reload(),0)});assert.equal((await dialog).type(),'beforeunload');assert.deepEqual(await read(),expected);
 probe.allow=true
}
