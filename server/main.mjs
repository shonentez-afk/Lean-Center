import path from 'node:path';
import {openPilot} from './lc74-store.mjs';
import {parsePilotUsers,createPilotServer,pilotAssets} from './lc74-http.mjs';
// Demo-only; never create default credentials or silently replace an existing database.
async function main(){
 if(process.env.LC_PILOT_DEMO!=='1')throw Error('LC_PILOT_DEMO=1 is required');
 const users=parsePilotUsers(process.env.LC_PILOT_USERS);
 const dataDir=process.env.LC_PILOT_DATA_DIR||'/data/lean-center-pilot';
 if(!path.isAbsolute(dataDir))throw Error('Absolute LC_PILOT_DATA_DIR required');
 const assets=await pilotAssets(path.resolve('dist/LeanCenterCloud'));
 const store=await openPilot({dataDir}),server=createPilotServer({store,users,assets,aiEnabled:process.env.LC_PILOT_AI==='1'});
 server.on('error',async()=>{await store.close();process.exitCode=1;console.error('Pilot HTTP listen error')});
 server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log(assets.identity.release+' '+assets.identity.sourceCommit.slice(0,8)+' demo UI and API listening'));
 let stopping=false;
 const shutdown=()=>{if(stopping)return;stopping=true;server.close(async()=>{try{await store.close()}catch{process.exitCode=1}})};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown)
}
main().catch(()=>{console.error('Pilot startup refused: verify environment, data and single-writer lock. No secrets logged.');process.exitCode=1});
