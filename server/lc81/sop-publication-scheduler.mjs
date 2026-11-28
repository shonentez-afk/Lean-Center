// Lifecycle owned by the production HTTP process, not by maintenance copies.
export function startSopPublicationScheduler(store,{intervalMs=30000,onError=()=>console.error('LC83_PUBLICATION_SCHEDULER_ERROR')}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid scheduler interval');
 let running=null,stopped=false;
 const tick=()=>{
  if(stopped||running)return;
  running=Promise.resolve().then(()=>store.runDueSopPublications()).catch(()=>onError()).finally(()=>{running=null});
 };
 const timer=setInterval(tick,intervalMs);timer.unref?.();tick();
 return {async stop(){stopped=true;clearInterval(timer);await running}};
}
