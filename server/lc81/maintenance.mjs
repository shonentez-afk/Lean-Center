// CLI only; use stopped, verified synthetic checkpoints. Never overwrite.
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPilot,PILOT_STATE} from '../lc74-store.mjs';
import {openSecureQA,recoverLockedSnapshot} from './store.mjs';
async function separate(source,target){
 if(!path.isAbsolute(source)||!path.isAbsolute(target))throw Error('Separate absolute paths required');
 const from=await fs.realpath(source),parent=await fs.realpath(path.dirname(target)),to=path.resolve(parent,path.basename(target));
 if(from===to||to.startsWith(from+path.sep)||from.startsWith(to+path.sep))throw Error('Separate storage directories required');
}
export async function migratePilotCopy({source,target,siteId,adminRoleId=null,managerRoleId=null,login='admin',password,siteTimeZone=null}){
 await separate(source,target);
 await fs.access(path.join(source,PILOT_STATE));
 // Source opened only for verified reads under the existing single-writer lock.
 const legacy=await openPilot({dataDir:source});
 let migrated;
 try{
  migrated=await openSecureQA({dataDir:target,initialize:true,login,password,siteTimeZone,seed:{snapshot:legacy.snapshot(),siteId,adminRoleId,managerRoleId,readSource:sha=>legacy.getSource(sha)}});
  return {database_id:legacy.head().database_id,source_sha256:legacy.head().snapshot_sha256};
 }finally{try{await migrated?.close()}finally{await legacy.close()}}
}
export async function copySecureCheckpoint(source,target){
 await separate(source,target);
 const store=await openSecureQA({dataDir:source});
 try{return await store.copyCheckpoint(target)}finally{await store.close()}
}

export async function recoverCopy(source,target,{confirmedOffline=false}={}){
 await separate(source,target);
 return recoverLockedSnapshot(source,target,{confirmedOffline});
}
