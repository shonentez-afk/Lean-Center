// Public, network-only worker. Never cache portal pages, API responses,
// documents, credentials, or employee data. Display fixed generic text.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let p;try{p=event.data?.json()}catch{}
 const id=p?.v===1&&typeof p.notice==='string'&&uuid.test(p.notice)?p.notice:null;
 event.waitUntil(self.registration.showNotification('Lean Center',{body:id?'У вас новое действие в портале':'Проверка уведомлений Lean Center',icon:'/assets/favicon.png',tag:'lc82-action',renotify:false,data:{notice:id}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const id=event.notification.data?.notice;
 const route=new URL('/',self.location.origin);
 if(typeof id==='string'&&uuid.test(id))route.hash='lc82-notice='+id;
 // Do not navigate an existing tab containing an unsaved work form.
 event.waitUntil(self.clients.openWindow(route.href));
});
// A browser may renew a subscription while logged out. Do not silently
// subscribe or attach it to any account. Explicit reconnect is required.
self.addEventListener('pushsubscriptionchange',event=>{
 event.waitUntil(self.registration.pushManager.getSubscription().then(s=>s?.unsubscribe()).catch(()=>{}));
});
