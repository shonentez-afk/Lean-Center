// Account, access and personnel lifecycle. All functions are called inside
// the single-writer checkpoint transaction after authenticating the actor.
import {one,rows,isId,uuid,applyEvent,recordPayload} from '../../src/core/db.js';
import {normalizeLogin,validPassword,hashPassword,generatePassword,verifyPassword} from './credentials.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const period=(x,d)=>!!x&&x.valid_from<=d&&(x.valid_to===null||x.valid_to>=d);
const reason=x=>typeof x==='string'&&x.trim().length>0&&x.length<=500;
const target=(db,id,revision)=>{
 const r=isId(id)&&one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
 must(r&&r.bootstrap!==1,403,'Защищённая или отсутствующая учётная запись');
 must(Number.isSafeInteger(revision)&&r.credential_revision===revision,409,'Учётная запись изменилась');
 return r;
};
function secret(db,r,password){
 db.run('UPDATE lc81_account SET password_hash=?,credential_revision=credential_revision+1 WHERE id=?',[hashPassword(password),r.id]);
 return {id:r.id,credential_revision:r.credential_revision+1};
}
export function changeOwnPassword(db,a,f,audit){
 must(exact(f,['current_password','new_password'])&&validPassword(f.new_password),422,'Новый пароль: от 12 до 128 байт');
 must(verifyPassword(f.current_password,a.password_hash),403,'Текущий пароль неверен');
 must(f.current_password!==f.new_password,422,'Новый пароль должен отличаться');
 const result=secret(db,a,f.new_password);audit('account.password.change',a.id);return result;
}
export function resetAccountPassword(db,f,audit){
 must(exact(f,['id','expected_revision','password','generate'])&&typeof f.generate==='boolean'&&(f.generate?f.password===null:validPassword(f.password)),422,'Укажите стойкий пароль');
 const r=target(db,f.id,f.expected_revision),password=f.generate?generatePassword():f.password;
 must(!verifyPassword(password,r.password_hash),422,'Новый пароль должен отличаться');
 const result=secret(db,r,password);audit('account.password.reset',r.id);return {...result,login:r.login,...(f.generate?{issued_password:password}:{})};
}
export function renameAccount(db,f,audit){
 must(exact(f,['id','expected_revision','login']),400,'Неверные реквизиты входа');
 const r=target(db,f.id,f.expected_revision),login=normalizeLogin(f.login);
 must(login&&login!==r.login,422,'Укажите новый уникальный логин или рабочую почту');
 must(!one(db,'SELECT id FROM lc81_account WHERE login=?',[login]),409,'Логин уже существует');
 db.run('UPDATE lc81_account SET login=?,credential_revision=credential_revision+1 WHERE id=?',[login,r.id]);audit('account.login.change',r.id);
 return {id:r.id,login,credential_revision:r.credential_revision+1};
}
export function grantStatus(db,g,day,site){
 if(g.state==='revoked')return 'revoked';
 if(g.valid_from>day)return 'future';
 if(g.valid_to&&g.valid_to<day)return 'expired';
 const a=one(db,'SELECT id,person_id,state FROM lc81_account WHERE id=?',[g.account_id]);
 if(!a||a.state!=='active')return 'blocked';
 const role=one(db,'SELECT id FROM business_role WHERE id=? AND archived=0',[g.role_id]),r=one(db,'SELECT * FROM role_assignment WHERE id=?',[g.assignment_id]);
 if(!role||!r||r.person_id!==a.person_id||r.role_id!==role.id||!period(r,day))return 'role_ended';
 const p=one(db,'SELECT revision FROM lc81_policy WHERE role_id=?',[g.role_id]);
 if(!p||p.revision!==g.policy_revision)return 'policy_changed';
 const active=rows(db,'SELECT id FROM person_assignment WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[a.person_id,day,day]);
 if(active.length!==1||active[0].id!==g.employment_id||!one(db,'SELECT id FROM person WHERE id=? AND archived=0',[a.person_id]))return 'employment_changed';
 if(g.scope?.kind==='unit_tree'){
  const visited=new Set();let id=g.scope.unit_id;
  while(id&&!visited.has(id)){visited.add(id);const u=one(db,'SELECT id,parent_id FROM org_unit WHERE id=? AND archived=0',[id]);if(!u)return 'scope_changed';if(u.parent_id===null){if(u.id!==site)return 'scope_changed';break}id=u.parent_id}
  if(id!==site)return 'scope_changed';
 }
 return 'effective';
}
export function endRole(db,f,{day,at,adminRole,audit}){
 must(exact(f,['id','expected_revision','valid_to','reason','revoke_now'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&date(f.valid_to)&&f.valid_to>=day&&reason(f.reason)&&typeof f.revoke_now==='boolean',400,'Укажите последний день роли и основание');
 const r=one(db,'SELECT * FROM role_assignment WHERE id=?',[f.id]);
 must(r&&r.role_id!==adminRole,403,'Назначение роли недоступно');
 must(r.rev===f.expected_revision&&r.valid_to===null,409,'Назначение уже изменено или закрыто');
 must(r.valid_from<=f.valid_to,422,'Последний день раньше начала роли');
 const event=uuid();
 try{applyEvent(db,{id:event,entity_type:'role_assignment',entity_id:r.id,operation:'update',expected_revision:r.rev,payload:{...recordPayload('role_assignment',r),valid_to:f.valid_to},occurred_at:at})}catch{throw new PilotError(422,'Роль не прошла доменную проверку')}
 // A scheduled end remains valid through the specified civil day. An
 // explicitly requested access revocation is immediate, not a role rewrite.
 const grants=rows(db,"SELECT id FROM lc81_grant WHERE assignment_id=? AND state='active'",[r.id]);
 if(f.revoke_now)for(const g of grants){db.run("UPDATE lc81_grant SET state='revoked',revoked_at=? WHERE id=?",[at,g.id]);audit('grant.revoke.role_end',g.id)}
 audit('role_assignment.end',event);
 // Reason is attached to the private audit, with immutable event reference.
 db.run("INSERT INTO lc81_meta(key,value) VALUES(?,?)",['reason:'+event,f.reason.trim()]);
 return {id:r.id,rev:r.rev+1,revoked:f.revoke_now?grants.length:0};
}
export function endEmployment(db,f,{day,at,audit}){
 must(exact(f,['id','expected_revision','valid_to','reason','block_now'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&date(f.valid_to)&&f.valid_to>=day&&reason(f.reason)&&typeof f.block_now==='boolean',400,'Укажите последний рабочий день и основание');
 const r=one(db,'SELECT * FROM person_assignment WHERE id=?',[f.id]);
 must(r&&r.valid_from<=day&&r.valid_to===null&&r.rev===f.expected_revision,409,'Кадровое назначение изменилось или уже закрыто');
 must(!one(db,'SELECT id FROM person_assignment WHERE person_id=? AND valid_from>?',[r.person_id,r.valid_from]),409,'Есть последующее кадровое назначение; проверьте историю');
 // Do not silently cancel training, obligations or authorizations. The HR
 // decision cannot erase an unresolved workflow or create orphaned owners.
 const id=r.person_id;
 const checks=[
  ["SELECT id FROM training_assignment WHERE state IN('planned','in_progress') AND (trainee_id=? OR mentor_id=? OR supervisor_id=?) LIMIT 1",[id,id,id],'Открытые назначения обучения'],
  ["SELECT id FROM training_enrollment WHERE state='active' AND (trainee_id=? OR mentor_id=? OR manager_id=?) LIMIT 1",[id,id,id],'Действующие персональные программы'],
  ["SELECT id FROM development_plan WHERE state='active' AND person_id=? LIMIT 1",[id],'Действующие планы развития'],
  ["SELECT id FROM action_item WHERE state IN('open','in_progress','implemented','ineffective') AND (owner_id=? OR subject_id=?) LIMIT 1",[id,id],'Незавершённые мероприятия'],
  ["SELECT id FROM schedule_event WHERE state='planned' AND owner_id=? LIMIT 1",[id],'Открытые планы календаря'],
  ["SELECT id FROM role_assignment WHERE person_id=? AND (valid_to IS NULL OR valid_to>?) LIMIT 1",[id,f.valid_to],'Роли действуют после последнего рабочего дня']
 ];
 const blockers=checks.filter(([sql,args])=>one(db,sql,args)).map(x=>x[2]);
 must(!blockers.length,422,'Перед завершением назначения урегулируйте: '+blockers.join('; '));
 const event=uuid();
 try{applyEvent(db,{id:event,entity_type:'person_assignment',entity_id:r.id,operation:'update',expected_revision:r.rev,payload:{...recordPayload('person_assignment',r),valid_to:f.valid_to},occurred_at:at})}catch{throw new PilotError(422,'Кадровое назначение не прошло доменную проверку')}
 const a=one(db,'SELECT id,state FROM lc81_account WHERE person_id=? AND bootstrap=0',[id]);
 if(a&&f.block_now){
  db.run("UPDATE lc81_account SET state='blocked',credential_revision=credential_revision+1 WHERE id=?",[a.id]);
  for(const g of rows(db,"SELECT id FROM lc81_grant WHERE account_id=? AND state='active'",[a.id])){db.run("UPDATE lc81_grant SET state='revoked',revoked_at=? WHERE id=?",[at,g.id]);audit('grant.revoke.employment_end',g.id)}
  audit('account.blocked.employment_end',a.id);
 }
 audit('employment.end',event);
 db.run("INSERT INTO lc81_meta(key,value) VALUES(?,?)",['reason:'+event,f.reason.trim()]);
 return {id:r.id,rev:r.rev+1,blocked:!!a&&f.block_now};
}
