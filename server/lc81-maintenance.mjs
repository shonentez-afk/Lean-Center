import {migratePilotCopy,copySecureCheckpoint,recoverCopy} from './lc81/maintenance.mjs';
const [mode,source,target,siteId,admin,manager,...extra]=process.argv.slice(2);
try{
 if(process.env.LC81_QA!=='1'||!source||!target||extra.length)throw Error('LC81_QA=1 required');
 let result;
 if(mode==='migrate-copy'){
  if(!siteId||!admin||!manager)throw Error('Explicit site and role mapping required');
  result=await migratePilotCopy({source,target,siteId,adminRoleId:admin==='new'?null:admin,managerRoleId:manager==='new'?null:manager,login:process.env.LC_BOOTSTRAP_ADMIN_LOGIN||'admin',password:process.env.LC_BOOTSTRAP_ADMIN_PASSWORD,siteTimeZone:process.env.LC81_SITE_TIME_ZONE||null});
 }else if(['backup','restore-new'].includes(mode)&&!siteId&&!admin&&!manager)result=await copySecureCheckpoint(source,target);
 else if(mode==='recover-copy'&&!siteId&&!admin&&!manager&&process.env.LC81_RECOVERY_OFFLINE==='1')result=await recoverCopy(source,target,{confirmedOffline:true});
 else throw Error('Unknown arguments');
 console.log(JSON.stringify(result));
}catch{console.error('LC8.1 maintenance refused: verify stopped source, new target, explicit role mapping, storage and secret. No secrets logged.');process.exitCode=1}
