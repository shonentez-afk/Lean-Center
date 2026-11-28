// Device consent and management. Keep only the opaque local device ID;
// no service worker cache, tokens, account name, or notification content.
const KEY='lc82-push-device',idPattern=/^[a-f0-9-]{36}$/i;
const localId=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
function remember(id){try{if(id)localStorage.setItem(KEY,id);else localStorage.removeItem(KEY)}catch{}}
export const pushSupported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const registration=()=>navigator.serviceWorker.getRegistration('/');
async function removeSubscription(){
 if(!pushSupported())return;
 const reg=await registration(),s=await reg?.pushManager.getSubscription();
 if(s&&!await s.unsubscribe())throw Error('Не удалось отключить подписку в браузере');
 for(const tag of ['lc82-action','lc82-test']){const ns=await reg?.getNotifications?.({tag});for(const n of ns||[])n.close()}
}
// Logout revokes server ownership before clearing browser capability. If
// server revocation fails, local unsubscribe still prevents future delivery.
export async function leavePushDevice(api){
 const id=localId();
 try{if(id&&idPattern.test(id))await api('notifications/push/revoke',{id})}catch{}
 try{await removeSubscription();remember(null)}catch{throw Error('Не удалось отключить Push на этом устройстве. Проверьте разрешения браузера и отзовите устройство в профиле.')}
}
export async function reconcilePushDevice(api,enabled){
 if(!pushSupported())return;
 const reg=await registration(),s=await reg?.pushManager.getSubscription();
 if(!s){remember(null);return}
 const id=localId();
 // On switching accounts, don't silently transfer the browser capability.
 let owned=false;
 if(enabled&&id&&idPattern.test(id)){
  try{const p=await api('notifications/push');owned=p.enabled&&p.devices.some(d=>d.id===id&&d.state==='active')}catch(e){if(e.name==='AbortError')return;throw e}
 }
 if(!owned){await removeSubscription();remember(null)}
}
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
export async function renderPushDevices(host,{api,el,button,input,table,run}){
 const p=await api('notifications/push');if(!host.isConnected)return;
 host.replaceChildren(el('h3','Устройства Web Push'),el('p',p.enabled?'Доставка включена администратором. Подключайте только личное устройство; на общем ПК не включайте Push.':'Web Push отключён администратором либо отсутствует настройка сервера.'),el('p','На экране блокировки отображается только общий текст. Нажатие открывает портал и проверяет ваши права; принятие сервисом доставки не означает прочтения.','muted'));
 const mine=localId(),labels={active:'Подключено',reconnect:'Требуется подключить заново',revoked:'Отозвано',expired:'Подписка истекла'};
 const refresh=()=>renderPushDevices(host,{api,el,button,input,table,run});
 host.append(table(['Устройство','Состояние','Последний запрос проверки','Действия'],p.devices.map(d=>{
  const controls=el('div',undefined,'row');
  if(d.state==='active'&&p.enabled)controls.append(button('Проверить',async()=>{
   await api('notifications/push/test',{id:d.id});message.textContent='Проверка поставлена в очередь, с учётом разрешённого времени. Это не подтверждение получения.';
  }));
  if(['active','reconnect'].includes(d.state))controls.append(button('Отключить',async()=>{
   await api('notifications/push/revoke',{id:d.id});if(d.id===mine){await removeSubscription();remember(null)}await refresh();
  }));
  return [d.label+(d.id===mine?' · это устройство':''),labels[d.state]||d.state,d.last_test_at?(d.last_test_at+' · '+({pending:'в очереди',retry:'повтор',sending:'передача',accepted:'принято сервисом',cancelled:'отменено',expired:'истекло',failed:'ошибка',uncertain:'не подтверждено'}[d.last_test_state]||'—')):'—',controls];
 })));
 const message=el('p','','muted');host.append(message);
 if(!pushSupported()){message.textContent='Этот браузер или режим не поддерживает Push. Внутренние уведомления продолжают работать.';return}
 if(!p.enabled)return;
 const label=input('device_label','Название личного устройства');label.querySelector('input').maxLength=80;
 host.append(label);
 // Register service worker before permission prompt so subscribe is possible
 // in the actual user gesture (including browsers with stricter policies).
 let reg;
 try{await navigator.serviceWorker.register('/sw.js',{scope:'/'});reg=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker timeout')),8000))])}catch{message.textContent='Не удалось подготовить Web Push. Проверьте HTTPS и политику браузера.';return}
 if(!host.isConnected)return;
 host.append(button('Включить Push на этом устройстве',async()=>{
  const text=label.querySelector('input').value.trim();if(!text||text.length>80)throw Error('Укажите название устройства');
  if(Notification.permission==='denied')throw Error('Разрешите уведомления в настройках сайта браузера');
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){message.textContent='Разрешение не предоставлено. Колокольчик работает независимо.';return}
  let subscription=await reg.pushManager.getSubscription();
  const expected=bytes(p.public_key);
  // An old endpoint from a different VAPID key or account must not be used.
  const key=subscription?.options.applicationServerKey;
  if(subscription&&(!p.devices.some(d=>d.id===localId()&&d.state==='active')||!key||String(new Uint8Array(key))!==String(expected))){
   if(!await subscription.unsubscribe())throw Error('Не удалось заменить старую подписку');subscription=null;
  }
  if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:expected});
  try{
   const json=subscription.toJSON();
   const saved=await api('notifications/push/register',{label:text,confirmed:true,subscription:{endpoint:subscription.endpoint,expirationTime:subscription.expirationTime??null,keys:{p256dh:json.keys.p256dh,auth:json.keys.auth}}});
   remember(saved.id);await refresh();
  }catch(e){await subscription.unsubscribe().catch(()=>{});remember(null);throw e}
 },'primary'));
}
