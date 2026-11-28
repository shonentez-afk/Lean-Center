// Separate QA entrypoint. Do not point at the live Amvera volume.
// Diagnostics are fixed codes, never raw exceptions or environment values.
import path from 'node:path';
import fs from 'node:fs/promises';
import {openSecureQA,restoreUploadedQA} from './lc81/store.mjs';
import {createSecureQAServer} from './lc81/http.mjs';
import {normalizeLogin,validPassword} from './lc81/credentials.mjs';
import {normalizeZone} from './lc81/site-clock.mjs';
import {startSopPublicationScheduler} from './lc81/sop-publication-scheduler.mjs';
class StartupError extends Error{
 constructor(code){super(code);this.code=code}
}
const requireSetting=(ok,code)=>{if(!ok)throw new StartupError(code)};
let phase='CONFIG';
const errno=new Set(['EACCES','EPERM','EROFS','ENOSPC','EDQUOT','ENOENT','ENOTDIR','EISDIR','EEXIST','EINVAL','EIO','ENOSYS','ENOTSUP','EMFILE','EADDRINUSE','EADDRNOTAVAIL']);
const storageReasons=new Map([
 ['Первичный запуск требует явной инициализации','INIT_REQUIRED'],
 ['Требуется начальный секрет администратора','BOOTSTRAP_SECRET_INVALID'],
 ['Часовой пояс уже хранится в базе; настройте его явно через администратора','STORAGE_TIME_ZONE_MISMATCH'],
 ['Отсутствует или повреждён маркер инициализации','STORAGE_MARKER_INVALID'],
 ['Повреждён контрольный снимок','STORAGE_CHECKSUM_INVALID'],
 ['Размер QA-хранилища','STORAGE_SIZE_INVALID'],
 ['Неизвестная схема авторизации','STORAGE_SCHEMA_INVALID'],
 ['Нарушена целостность начального администратора','STORAGE_ADMIN_INVALID'],
 ['Повреждены данные авторизации','STORAGE_CREDENTIALS_INVALID'],
 ['Отсутствует или повреждён исходник','STORAGE_DOCUMENT_INVALID'],
 ['Загрузка QA не совпадает с существующим хранилищем','IMPORT_TARGET_MISMATCH'],
 ['Контрольная сумма загрузки QA не совпадает','IMPORT_CHECKSUM_INVALID'],
 ['Неверный формат загрузки QA','IMPORT_FORMAT_INVALID'],
 ['Набор загруженных документов не совпадает','IMPORT_DOCUMENTS_INVALID'],
 ['Неверный файл загрузки QA','IMPORT_FILE_INVALID']
]);
function report(e){
 const step=phase==='STORAGE_OPEN'&&['LOCK','CHECKPOINT','MARKER','DOCUMENTS'].includes(e?.lc81StorageStep)?'STORAGE_'+e.lc81StorageStep:phase;
 const reason=e instanceof StartupError?e.code:['STORAGE_OPEN','IMPORT'].includes(phase)&&storageReasons.has(e?.message)?storageReasons.get(e.message):errno.has(e?.code)?step+'_'+e.code:step+'_FAILED';
 console.error('LC8.1 QA startup refused: '+reason+'. No secrets logged.');
}
async function exists(file){
 try{return await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return null;throw e}
}
async function main(){
 const env=process.env;
 requireSetting(env.LC81_QA==='1','QA_MODE_REQUIRED');
 requireSetting(env.LC_PILOT_DEMO!=='1'&&!env.LC_PILOT_USERS,'LEGACY_ENV_PRESENT');
 const dataDir=env.LC81_DATA_DIR;
 requireSetting(dataDir&&path.isAbsolute(dataDir)&&path.resolve(dataDir)!==path.parse(path.resolve(dataDir)).root,'DATA_PATH_INVALID');
 const origin=env.LC81_ORIGIN;
 let u;try{u=new URL(origin)}catch{}
 requireSetting(u?.protocol==='https:'&&u.origin===origin,'ORIGIN_INVALID');
 const siteTimeZone=env.LC81_SITE_TIME_ZONE||null;
 requireSetting(siteTimeZone===null||!!normalizeZone(siteTimeZone),'TIME_ZONE_INVALID');
 const schedulerDisabled=env.LC81_SCHEDULER_DISABLED;
 requireSetting(schedulerDisabled===undefined||schedulerDisabled==='1','SCHEDULER_SETTING_INVALID');
 const loopbackOnly=env.LC81_LOOPBACK_ONLY;
 requireSetting(loopbackOnly===undefined||loopbackOnly==='1','LOOPBACK_SETTING_INVALID');
 const bindHost=loopbackOnly==='1'?'127.0.0.1':'0.0.0.0';
 const port=Number(env.PORT||8080);
 requireSetting(Number.isInteger(port)&&port>0&&port<=65535,'PORT_INVALID');
 const initialize=env.LC81_INIT==='1',login=env.LC_BOOTSTRAP_ADMIN_LOGIN||'admin',password=env.LC_BOOTSTRAP_ADMIN_PASSWORD;
 // Read-only preflight. Never delete data, clear a lock, reinitialize an
 // existing empty directory, or replace an existing administrator.
 phase='STORAGE_PREFLIGHT';
 const importFile=env.LC81_IMPORT_FILE||null,importDigest=env.LC81_IMPORT_SHA256||null;
 requireSetting((importFile===null)===(importDigest===null),'IMPORT_SETTINGS_INVALID');
 if(importFile){requireSetting(!initialize&&path.isAbsolute(importFile)&&path.resolve(importFile)===importFile&&path.resolve(dataDir)===dataDir&&path.dirname(importFile)===path.dirname(dataDir)&&importFile!==dataDir&&/^[a-f0-9]{64}$/.test(importDigest),'IMPORT_SETTINGS_INVALID')}
 let dir=await exists(dataDir);
 if(!dir&&importFile){
  requireSetting(validPassword(password),'BOOTSTRAP_SECRET_INVALID');
  phase='IMPORT';await restoreUploadedQA({bundleFile:importFile,expectedSha:importDigest,dataDir,password,siteTimeZone});
  console.log('LC8.1 QA upload restored with new credentials. Remove import variables and initial secret.');
  phase='STORAGE_PREFLIGHT';dir=await exists(dataDir);
 }
 if(!dir){
  const parent=await fs.stat(path.dirname(path.resolve(dataDir))).catch(e=>{if(e.code==='ENOENT')throw new StartupError('DATA_PARENT_MISSING');throw e});
  requireSetting(parent.isDirectory(),'DATA_PARENT_INVALID');
  requireSetting(initialize,'INIT_REQUIRED');
  requireSetting(!!normalizeLogin(login),'BOOTSTRAP_LOGIN_INVALID');
  requireSetting(validPassword(password),'BOOTSTRAP_SECRET_INVALID');
 }else{
  requireSetting(dir.isDirectory(),'DATA_PATH_NOT_DIRECTORY');
  requireSetting(!(await exists(path.join(dataDir,'writer.lock'))),'STORAGE_LOCK_PRESENT');
  const checkpoint=await exists(path.join(dataDir,'secure.lc81')),marker=await exists(path.join(dataDir,'initialized'));
  requireSetting(checkpoint?.isFile()&&marker?.isFile(),'STORAGE_INCOMPLETE');
 }
 phase='STORAGE_OPEN';
 const store=await openSecureQA({dataDir,initialize,login,password,siteTimeZone,importDigest});
 phase='HTTP_CREATE';
 let server;
 try{server=createSecureQAServer({store,origin,cloudAiEnabled:env.LC81_CLOUD_AI==='1',editorAiEnabled:env.LC81_EDITOR_AI==='1'});}catch(e){await store.close();throw e}
 phase='HTTP_LISTEN';
 let stopping=false,scheduler=null;
 server.on('error',async e=>{report(e);stopping=true;try{await scheduler?.stop();await store.close()}catch{}process.exitCode=1});
 server.listen(port,bindHost,()=>{
  console.log('LC8.1 QA authentication and limited projections listening');
  if(!stopping&&schedulerDisabled!=='1')scheduler=startSopPublicationScheduler(store);
 });
 const shutdown=()=>{if(stopping)return;stopping=true;const stopped=scheduler?.stop();server.close(async()=>{try{await stopped;await store.close()}catch{process.exitCode=1}})};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
main().catch(e=>{report(e);process.exitCode=1});
