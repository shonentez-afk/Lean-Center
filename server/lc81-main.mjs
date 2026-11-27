// Separate QA entrypoint. Do not point at the live Amvera volume.
import path from 'node:path';
import {openSecureQA} from './lc81/store.mjs';
import {createSecureQAServer} from './lc81/http.mjs';
async function main(){
 if(process.env.LC81_QA!=='1'||process.env.LC_PILOT_DEMO==='1'||process.env.LC_PILOT_USERS)throw Error('Explicit separate LC81 QA mode required; legacy environment forbidden');
 const dataDir=process.env.LC81_DATA_DIR;
 if(!dataDir||!path.isAbsolute(dataDir))throw Error('LC81_DATA_DIR required');
 const store=await openSecureQA({dataDir,initialize:process.env.LC81_INIT==='1',login:process.env.LC_BOOTSTRAP_ADMIN_LOGIN||'admin',password:process.env.LC_BOOTSTRAP_ADMIN_PASSWORD});
 let server;
 try{server=createSecureQAServer({store,origin:process.env.LC81_ORIGIN,cloudAiEnabled:process.env.LC81_CLOUD_AI==='1'});}catch(e){await store.close();throw e}
 server.on('error',async()=>{await store.close();process.exitCode=1;console.error('LC8.1 QA HTTP listen error')});
 server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('LC8.1 QA authentication and limited projections listening'));
 let stopping=false;const shutdown=()=>{if(stopping)return;stopping=true;server.close(async()=>{try{await store.close()}catch{process.exitCode=1}})};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
main().catch(()=>{console.error('LC8.1 QA startup refused: verify mode, origin, initialization, initial secret and protected storage. No secrets logged.');process.exitCode=1});
