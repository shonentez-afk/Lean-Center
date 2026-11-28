import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fixture,SQL,makeSop} from './lc4-fixture.mjs';
import {prepareSnapshot,uuid} from '../src/core/db.js';
import {copyPilotCheckpoint} from '../server/lc74-store.mjs';
import {migratePilotCopy} from '../server/lc81/maintenance.mjs';
import {openSecureQA} from '../server/lc81/store.mjs';
export const context=(command,operation_id,id=null,revision_id=null)=>({kind:'sop',command,id,revision_id,operation_id,origin_id:null,origin_revision:null});
export const request=(context,expected_revision,title,text)=>({request_id:uuid(),context,expected_revision,title,code:null,observed_at:null,text});
export async function setupApproval(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc83-approval-'));
 let f,store;
 try{
  f=await fixture();const w=f.w,site=w.edit('org_unit',null,{code:'LC83-SITE',name:'Учебный завод',kind:'Предприятие',parent_id:null});
  w.edit('org_unit',f.unit,{code:'QA',name:'Учебный участок',kind:'Участок',parent_id:site});
  const unitB=w.edit('org_unit',null,{code:'LC83-B',name:'Другой участок',kind:'Участок',parent_id:site});
  const adminRole=w.edit('business_role',null,{code:'LC83-ADMIN',name:'Администратор'}),managerRole=w.edit('business_role',null,{code:'LC83-MANAGER',name:'Управляющий центром TWI'});
  const assign=(person_id,role_id)=>w.edit('role_assignment',null,{person_id,role_id,valid_from:'2020-01-01',valid_to:null});
  const managerAssignment=assign(f.actor,managerRole);
  const defs={safety:['SAFETY_HEAD','Руководитель ОТ',['safety']],engineering:['CHIEF_ENGINEER','Главный инженер',['engineering']],twi:['INTERNAL_TRAINER','Внутренний тренер',['twi']],director:['DIRECTOR','Директор предприятия',['director','publish','withdraw']]};
  const roles={},people={};
  for(const [k,[code,name]] of Object.entries(defs))roles[k]=w.edit('business_role',null,{code,name});
  for(const [name,role,unit] of [['safety','safety',f.unit],['safety2','safety',f.unit],['outside','safety',unitB],['engineering','engineering',f.unit],['twi','twi',f.unit],['uncertified','twi',f.unit],['director','director',site]]){
   const person=w.edit('person',null,{employee_code:'LC83-'+name,display_name:'Учебный '+name});
   w.edit('person_assignment',null,{person_id:person,unit_id:unit,profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:'2020-01-01',valid_to:null});
   people[name]={person,assignment:assign(person,roles[role]),unit};
  }
  const cert=(await f.save('mentor_credential',{person_id:people.twi.person,kind:'certificate',role:'internal_trainer',number:'LC83-VT',issuer:'Учебный центр',issued_on:'2020-01-01',valid_until:null,evidence:'Учебный сертификат',registered_by:f.actor})).entity_id;
  await f.save('mentor_appointment',{person_id:people.twi.person,credential_id:cert,role:'internal_trainer',order_number:'LC83-ORDER',order_on:'2020-01-01',approved_by:f.actor,valid_from:'2020-01-01',valid_to:null,acknowledged_on:'2020-01-01',evidence:'Учебный приказ'});
  const assignment=await f.addAssignment();
  await w.acceptOwn(f.readContent);
  const source=path.join(root,'legacy'),target=path.join(root,'secure');
  await copyPilotCheckpoint({SQL,snapshot:await prepareSnapshot(w),readSource:f.readContent,target:source});
  const password=randomBytes(24).toString('base64url');
  await migratePilotCopy({source,target,siteId:site,adminRoleId:adminRole,managerRoleId:managerRole,login:'admin',password});
  store=await openSecureQA({dataDir:target});
  const admin=store.authenticate('admin',password),users={};
  const account=async(name,person_id)=>users[name]=await store.createAccount(admin.id,{person_id,login:name,password,generate:false});
  const grant=async(name,assignment_id,unit_id)=>store.grant(admin.id,{account_id:users[name].id,assignment_id,scope:{kind:'unit_tree',unit_id},valid_to:null});
  await account('author',f.trainee);await account('observer',f.other);await account('manager',f.actor);await grant('manager',managerAssignment,site);
  for(const [k,def] of Object.entries(defs))await store.setPolicy(admin.id,{role_id:roles[k],revision:0,permissions:def[2].map(x=>'sop.approval.'+x)});
  for(const [name,p] of Object.entries(people)){await account(name,p.person);p.grant=await grant(name,p.assignment,p.unit)}
  const day=store.adminData(admin.id).clock.day;
  const old=f.doc.id,document=f.doc.entity_id,operation=f.operation;
  const detail=(name,id,round=null)=>store.approvalDetail(users[name].id,1,id,round);
  const draft=async (action='Новая учебная операция',from=old)=>{
   const ctx=context('revise',operation,document,from),original=await store.openLibrary(users.author.id,1,ctx),src=await makeSop(action);
   return store.saveLibrary(users.author.id,1,request(ctx,original.expected_revision,action,src.text));
  };
  const passport=async d=>store.passportLibrary(users.author.id,1,{id:d.id,revision_id:d.revision_id,expected_revision:d.rev,print_format:'portrait',changed_on:day});
  const edit=async(d,action)=>{
   const ctx=context('save',operation,document,d.revision_id),src=await makeSop(action),info=detail('author',d.revision_id);
   return store.saveLibrary(users.author.id,1,request(ctx,info.document_rev,action,src.text));
  };
  const route=(id,mode='parallel',overrides={})=>({revision_id:id,expected_revision:detail('author',id).document_rev,mode,participants:['safety','engineering','twi','director','publish'].map(stage=>({stage,account_id:users[overrides[stage]||(stage==='publish'?'director':stage)].id,due_on:day})),note:'Учебный маршрут'});
  const submit=(id,mode='parallel',overrides={})=>store.submitSopApproval(users.author.id,1,route(id,mode,overrides));
  const decision=(name,id,stage,command='approve',note='')=>{
   const d=detail(name,id);return {revision_id:id,round_id:d.round.id,expected_revision:d.document_rev,expected_round_revision:d.round.rev,command,stage,note};
  };
  const change=(name,id,stage,command='approve',note='')=>store.changeSopApproval(users[name].id,1,decision(name,id,stage,command,note));
  const effective=(name='observer')=>store.listResources(users[name].id,'sop.read_effective').map(x=>x.revision_id);
  const cleanup=async()=>{await store.close();f.w.close();await fs.rm(root,{recursive:true,force:true})};
  return {root,target,store,admin,users,people,password,day,old,document,operation,assignment,detail,draft,passport,edit,route,submit,decision,change,effective,cleanup};
 }catch(e){if(store)await store.close();if(f)f.w.close();await fs.rm(root,{recursive:true,force:true});throw e}
}
