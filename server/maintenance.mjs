// Run only while the server is stopped. No credentials or destructive in-place restore.
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPilot,restorePilotCheckpoint,PILOT_STATE} from './lc74-store.mjs';
const [mode,source,target,...extra]=process.argv.slice(2);
try{
 if(extra.length||!['backup','restore-new'].includes(mode)||!source||!target||!path.isAbsolute(source)||!path.isAbsolute(target))throw Error('Usage: node server/maintenance.mjs backup|restore-new ABS_SOURCE ABS_NEW_TARGET');
 if(mode==='backup'){
  await fs.access(path.join(source,PILOT_STATE));
  const store=await openPilot({dataDir:source});
  try{const m=await store.exportCheckpoint(target);console.log('Verified backup: '+m.id+' '+m.snapshot_sha256)}finally{await store.close()}
 }else{
  const m=await restorePilotCheckpoint(source,target);console.log('Verified restored copy: '+m.id+' '+m.snapshot_sha256)
 }
}catch(e){console.error('Maintenance refused: '+e.message);process.exitCode=1}
