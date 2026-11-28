// Narrow RFC 8291 / RFC 8292 Web Push transport using Node's audited crypto.
// https://www.rfc-editor.org/rfc/rfc8291 and /rfc/rfc8292.
// No proxy, redirects, client-selected content, or arbitrary outbound hosts.
import {createECDH,createPrivateKey,createCipheriv,hkdfSync,randomBytes,sign,createHash} from 'node:crypto';
import {request} from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import path from 'node:path';

const b64=b=>Buffer.from(b).toString('base64url');
function decode(s,n){
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length>128)throw Error('Invalid push key');
 const b=Buffer.from(s,'base64url');if(b.length!==n||b64(b)!==s)throw Error('Invalid push key');return b;
}
export function pushEndpoint(s){
 if(typeof s!=='string'||s.length>2048||/[\x00-\x20\x7f\\]/.test(s))return null;
 let u;try{u=new URL(s)}catch{return null}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||u.href!==s)return null;
 const h=u.hostname;
 // Explicit supported browser providers, not arbitrary URLs or user DNS.
 if(h==='fcm.googleapis.com'&&/^\/(?:fcm\/send|wp)\/[A-Za-z0-9:_-]+$/.test(u.pathname)&&!u.search)return u;
 if(h==='updates.push.services.mozilla.com'&&/^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.search)return u;
 // Microsoft-managed WNS host and a channel path (opaque query allowed).
 if(/^[a-z0-9-]+\.notify\.windows\.com$/.test(h)&&/^\/[A-Za-z0-9_./%~-]+$/.test(u.pathname)&&u.pathname!=='/')return u;
 return null;
}
export function validatePushSubscription(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||!Object.hasOwn(s,'endpoint')||!Object.hasOwn(s,'keys')||!Object.hasOwn(s,'expirationTime')||!pushEndpoint(s.endpoint)||!(s.expirationTime===null||Number.isSafeInteger(s.expirationTime)&&s.expirationTime>0)||!s.keys||Object.keys(s.keys).length!==2)throw Error('Invalid push subscription');
 const ua=decode(s.keys.p256dh,65),auth=decode(s.keys.auth,16);
 if(ua[0]!==4)throw Error('Invalid push point');
 // OpenSSL validates the P-256 point before use.
 const probe=createECDH('prime256v1');probe.generateKeys();probe.computeSecret(ua);
 return {endpoint:s.endpoint,p256dh:b64(ua),auth:b64(auth),expiration_time:s.expirationTime};
}
export function vapidFromPrivate(value,subject){
 const d=decode(value,32),ec=createECDH('prime256v1');ec.setPrivateKey(d);
 if(typeof subject!=='string'||subject.length>240||!/^mailto:[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(subject))throw Error('Invalid VAPID contact');
 const pub=ec.getPublicKey(null,'uncompressed'),key=createPrivateKey({key:{kty:'EC',crv:'P-256',x:b64(pub.subarray(1,33)),y:b64(pub.subarray(33)),d:b64(d)},format:'jwk'});
 return {public_key:b64(pub),fingerprint:createHash('sha256').update(pub).digest('hex'),key,subject};
}
export function loadPushConfig(env,origin,dataDir){
 const flag=env.LC82_PUSH_ENABLED;
 if(flag!==undefined&&!['0','1'].includes(flag))throw Error('PUSH_SETTING_INVALID');
 if(flag!=='1'||env.LC81_SCHEDULER_DISABLED==='1')return null;
 // An explicit deployment binding is required even if a restored DB
 // contains subscriptions. Secrets remain outside the packaged release.
 if(new URL(origin).hostname==='localhost'||isIP(new URL(origin).hostname)||env.LC82_PUSH_ORIGIN!==origin||env.LC82_PUSH_DATA_DIR!==path.resolve(dataDir)||env.LC82_INBOX_ENABLED==='0'||env.LC82_BACKGROUND_ENABLED==='0')throw Error('PUSH_DEPLOYMENT_BINDING_INVALID');
 if(!/^[a-f0-9]{64}$/.test(env.LC82_PUSH_INSTANCE||''))throw Error('PUSH_INSTANCE_INVALID');
 const v=vapidFromPrivate(env.LC82_VAPID_PRIVATE,env.LC82_VAPID_SUBJECT),storage=path.resolve(dataDir);
 const binding=createHash('sha256').update(JSON.stringify([origin,storage,v.fingerprint,env.LC82_PUSH_INSTANCE])).digest('hex');
 return Object.freeze({...v,origin,storage,binding});
}
export function encryptPush(subscription,plaintext,{salt=randomBytes(16),senderPrivate=null}={}){
 const ua=decode(subscription.p256dh,65),auth=decode(subscription.auth,16),ec=createECDH('prime256v1');
 if(senderPrivate)ec.setPrivateKey(senderPrivate);else ec.generateKeys();
 const as=ec.getPublicKey(null,'uncompressed'),secret=ec.computeSecret(ua);
 const hk=(ikm,salt,info,n)=>Buffer.from(hkdfSync('sha256',ikm,salt,info,n));
 const ikm=hk(secret,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua,as]),32);
 const cek=hk(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hk(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const data=Buffer.from(plaintext);if(data.length>3993||salt.length!==16)throw Error('Invalid push payload');
 const cipher=createCipheriv('aes-128-gcm',cek,nonce),rs=Buffer.alloc(4);rs.writeUInt32BE(4096);
 return Buffer.concat([salt,rs,Buffer.from([65]),as,cipher.update(Buffer.concat([data,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
}
export function vapidAuthorization(config,endpoint,now=Date.now()){
 const u=pushEndpoint(endpoint);if(!u)throw Error('Invalid push destination');
 const jwt=b64(JSON.stringify({typ:'JWT',alg:'ES256'}))+'.'+b64(JSON.stringify({aud:u.origin,exp:Math.floor(now/1000)+3600,sub:config.subject}));
 return 'vapid t='+jwt+'.'+b64(sign('sha256',Buffer.from(jwt),{key:config.key,dsaEncoding:'ieee-p1363'}))+', k='+config.public_key;
}
// Only globally routable IPv4, pinned via the HTTPS lookup callback. No
// IPv4-mapped IPv6, loopback, metadata, RFC1918, CGNAT or special ranges.
export function publicIPv4(ip){
 if(isIP(ip)!==4)return false;
 const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
function pinnedLookup(host,options,cb){
 lookup(host,{family:4,all:true},(err,addresses)=>{
  if(err||!addresses?.length||addresses.some(x=>!publicIPv4(x.address)))return cb(Error('Push destination unavailable'));
  const a=addresses[0];return options?.all?cb(null,[a]):cb(null,a.address,4);
 });
}
export async function sendWebPush(config,device,noticeId,{ttl=300}={}){
 const endpoint=pushEndpoint(device.endpoint);if(!endpoint)throw Error('Invalid push destination');
 // Only an opaque ID, no name, role, SOP title, device label or free text.
 const payload=JSON.stringify({v:1,notice:noticeId||null});
 const body=encryptPush(device,payload);
 const headers={Authorization:vapidAuthorization(config,device.endpoint),'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Content-Length':String(body.length),TTL:String(Math.max(0,Math.min(300,Math.floor(ttl)))),'Urgency':'normal',Topic:noticeId?'lc82_action':'lc82_test'};
 // TLS server name and certificate checks remain enabled; never follow 3xx.
 return new Promise((resolve,reject)=>{
  const req=request(endpoint,{method:'POST',headers,lookup:pinnedLookup,agent:false,family:4,signal:AbortSignal.timeout(8000)},res=>{
   const code=res.statusCode||0,raw=res.headers['retry-after'],retry=typeof raw==='string'?(/^\d{1,6}$/.test(raw)?Number(raw):Number.isFinite(Date.parse(raw))?Math.max(0,Math.ceil((Date.parse(raw)-Date.now())/1000)):null):null;
   res.resume();res.on('error',reject);res.on('end',()=>resolve({status:code,retry_after:retry}));
  });
  req.on('error',reject);req.end(body);
 });
}
