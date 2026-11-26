// CLI only; use stopped, verified synthetic checkpoints. Never overwrite.
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPilot,PILOT_STATE} from '../lc74-store.mjs';
import {openSecureQA} from './store.mjs';
export async function migratePilotCopy({source,target,siteId,adminRoleId=null,managerRoleId=null,login='admin',password}){
 if(!path.isAbsolute(source)||!path.isAbsolute(target)||path.resolve(source)===path.resolve(target))throw Error('Separate absolute paths required');
 await fs.access(path.join(source,PILOT_STATE));
 // Source opened only for verified reads under the existing single-writer lock.
 const legacy=await openPilot({dataDir:source});
 let migrated;
 try{
  migrated=await openSecureQA({dataDir:target,initialize:true,login,password,seed:{snapshot:legacy.snapshot(),siteId,adminRoleId,managerRoleId,readSource:sha=>legacy.getSource(sha)}});
  return {database_id:legacy.head().database_id,source_sha256:legacy.head().snapshot_sha256};
 }finally{try{await migrated?.close()}finally{await legacy.close()}}
}
export async function copySecureCheckpoint(source,target){
 if(!path.isAbsolute(source)||!path.isAbsolute(target)||path.resolve(source)===path.resolve(target))throw Error('Separate absolute paths required');
 const store=await openSecureQA({dataDir:source});
 try{return await store.copyCheckpoint(target)}finally{await store.close()}
}
