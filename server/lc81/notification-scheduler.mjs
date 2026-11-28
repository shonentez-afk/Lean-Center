// Process-owned local queue worker. Maintenance copies disable ALL workers
// with LC81_SCHEDULER_DISABLED=1. There is no public runner endpoint.
export function startNotificationBackground(store,{intervalMs=60000,onError=()=>console.error('LC82_NOTIFICATION_BACKGROUND_ERROR')}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid notification worker interval');
 let running=null,stopped=false;
 const tick=()=>{
  if(stopped||running)return;
  running=Promise.resolve().then(()=>store.runNotificationBackground()).catch(()=>onError()).finally(()=>{running=null});
 };
 const timer=setInterval(tick,intervalMs);timer.unref?.();tick();
 return {async stop(){stopped=true;clearInterval(timer);await running}};
}

export function startPushDelivery(store,{intervalMs=15000,onError=()=>console.error('LC82_PUSH_WORKER_ERROR')}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw Error('Invalid push worker interval');
 let running=null,stopped=false;
 const tick=()=>{
  if(stopped||running)return;
  running=Promise.resolve().then(()=>store.runPushDelivery()).catch(()=>onError()).finally(()=>{running=null});
 };
 const timer=setInterval(tick,intervalMs);timer.unref?.();tick();
 return {async stop(){stopped=true;clearInterval(timer);await running}};
}
