import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotSql} from '../server/lc74-store.mjs';
import {createDb,uuid} from '../src/core/db.js';
import {readAuthorized,READ_ACTIONS} from '../server/lc81/read-policy.mjs';
const {SQL,schema,migration}=await pilotSql();
const day='2026-11-27';
function fixture(t){
 const db=createDb(SQL,schema,migration);t.after(()=>db.close());
 const ids=Object.fromEntries(['site','unitA','unitB','personA','personB','roleA','roleB','assignmentA','assignmentB','account','grantA','grantB','opA','docA','revisionA','trainA','taskA'].map(k=>[k,uuid()]));
 const i=ids;
 for(const [id,parent,code,kind] of [[i.site,null,'SITE','Предприятие'],[i.unitA,i.site,'A','Участок'],[i.unitB,i.site,'B','Участок']])db.run('INSERT INTO org_unit(id,parent_id,code,name,kind) VALUES(?,?,?,?,?)',[id,parent,code,code,kind]);
 for(const [id,unit,code] of [[i.personA,i.unitA,'A'],[i.personB,i.unitB,'B']]){
  db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,code,'Учебный '+code]);
  db.run('INSERT INTO person_assignment(id,person_id,unit_id,valid_from) VALUES(?,?,?,?)',[uuid(),id,unit,'2020-01-01']);
 }
 for(const [role,assignment,code] of [[i.roleA,i.assignmentA,'ROLE-A'],[i.roleB,i.assignmentB,'ROLE-B']]){
  db.run('INSERT INTO business_role(id,code,name) VALUES(?,?,?)',[role,code,code]);
  db.run('INSERT INTO role_assignment(id,person_id,role_id,valid_from) VALUES(?,?,?,?)',[assignment,i.personA,role,'2020-01-01']);
 }
 db.run('INSERT INTO operation(id,unit_id,code,name) VALUES(?,?,?,?)',[i.opA,i.unitA,'OP','Учебная операция']);
 db.run("INSERT INTO document(id,code,kind,operation_id,title) VALUES(?,?,'sop',?,?)",[i.docA,'SOP',i.opA,'Учебный СОП']);
 db.run("INSERT INTO document_revision(id,document_id,version_no,state,payload_json,created_at,effective_at) VALUES(?,?,1,'effective',?,?,?)",[i.revisionA,i.docA,'{"private":"not returned"}',day+'T00:00:00Z',day+'T00:00:00Z']);
 db.run("INSERT INTO training_assignment(id,trainee_id,mentor_id,operation_id,sop_revision_id,due_on,state) VALUES(?,?,?,?,?,?,'planned')",[i.trainA,i.personB,i.personA,i.opA,i.revisionA,day]);
 db.run("INSERT INTO action_item(id,owner_id,title,due_on,state) VALUES(?,?,?,?,'open')",[i.taskA,i.personA,'Учебная задача',day]);
 const grant=(id,role,assignment,scope)=>({id,account_id:i.account,role_id:role,assignment_id:assignment,scope,policy_revision:1,state:'active',revoked_at:null,valid_from:'2020-01-01',valid_to:null});
 const security={accounts:[{id:i.account,person_id:i.personA,state:'active'}],policies:[{role_id:i.roleA,revision:1,permissions:['person.read_basic','sop.read_effective']},{role_id:i.roleB,revision:1,permissions:['training.read','task.read']}],grants:[grant(i.grantA,i.roleA,i.assignmentA,{kind:'unit_tree',unit_id:i.unitA}),grant(i.grantB,i.roleB,i.assignmentB,{kind:'assigned'})]};
 const read=(action,id,asOf=day,account=i.account)=>readAuthorized(db,security,account,action,id,asOf);
 return {db,i,security,read};
}
test('existing role assignments plus explicit grants and unit hierarchy; no scope mixing',t=>{
 const {i,security,read}=fixture(t);
 assert.deepEqual(read('person.read_basic',i.personA).data,{id:i.personA,display_name:'Учебный A'});
 assert.equal(read('person.read_basic',i.personB),null);
 security.grants[1].scope={kind:'unit_tree',unit_id:i.site};
 assert.equal(read('person.read_basic',i.personB),null,'scope of a different role is not borrowed');
 security.grants[0].scope={kind:'unit_tree',unit_id:i.site};
 assert.equal(read('person.read_basic',i.personB).data.id,i.personB);
 security.grants=[];assert.equal(read('person.read_basic',i.personA),null,'domain roles alone grant nothing');
});
test('archive, revocation, expiry, policy revision and identity are checked on each read',t=>{
 const {db,i,security,read}=fixture(t);
 const allowed=()=>assert(read('person.read_basic',i.personA));
 const denied=()=>assert.equal(read('person.read_basic',i.personA),null);
 allowed();
 security.accounts[0].state='blocked';denied();security.accounts[0].state='active';
 security.grants[0].revoked_at=day;denied();security.grants[0].revoked_at=null;
 security.grants[0].valid_to='2026-11-26';denied();security.grants[0].valid_to=day;allowed();
 security.policies[0].revision=2;denied();security.grants[0].policy_revision=2;allowed();
 security.grants[0].assignment_id=i.assignmentB;denied();security.grants[0].assignment_id=i.assignmentA;
 db.run('UPDATE role_assignment SET valid_to=? WHERE id=?',['2026-11-26',i.assignmentA]);denied();
 db.run('UPDATE role_assignment SET valid_to=NULL WHERE id=?',[i.assignmentA]);allowed();
 db.run('UPDATE business_role SET archived=1 WHERE id=?',[i.roleA]);denied();
 db.run('UPDATE business_role SET archived=0 WHERE id=?',[i.roleA]);allowed();
 db.run('UPDATE person SET archived=1 WHERE id=?',[i.personA]);denied();
 db.run('UPDATE person SET archived=0 WHERE id=?',[i.personA]);allowed();
 db.run('UPDATE org_unit SET archived=1 WHERE id=?',[i.site]);denied();
});
test('limited projections, own vs assigned work, no unpublished SOP or raw data',t=>{
 const {db,i,security,read}=fixture(t);
 const sop=read('sop.read_effective',i.revisionA).data;
 assert.equal(sop.state,'effective');assert.equal(sop.document_id,i.docA);
 assert(!Object.hasOwn(sop,'payload_json'));assert(!JSON.stringify(sop).includes('not returned'));
 db.run("UPDATE document_revision SET state='draft' WHERE id=?",[i.revisionA]);assert.equal(read('sop.read_effective',i.revisionA),null);
 assert.equal(read('training.read',i.trainA).data.id,i.trainA);
 security.grants[1].scope={kind:'self'};assert.equal(read('training.read',i.trainA),null);assert.equal(read('task.read',i.taskA).data.id,i.taskA);
 security.grants[1].scope={kind:'unit_tree',unit_id:i.unitA};assert.equal(read('training.read',i.trainA),null,'trainee outside scope');assert.equal(read('task.read',i.taskA).data.id,i.taskA,'standalone task follows owner scope');
 security.grants[1].scope={kind:'assigned'};db.run("UPDATE training_assignment SET state='cancelled' WHERE id=?",[i.trainA]);assert.equal(read('training.read',i.trainA),null);
});
test('unknown actions, invalid IDs, duplicate policies, ambiguous accounts and corrupt hierarchy deny',t=>{
 const {db,i,security,read}=fixture(t);
 for(const action of ['sop.approve_final','sop.review_ot','sop.publish','account.manage','snapshot','__proto__','person.write'])assert.equal(read(action,i.personA),null);
 assert.equal(READ_ACTIONS.length,22);assert.equal(read('person.read_basic',i.personA,'2026-02-30'),null);
 assert.equal(read('person.read_basic',i.personA,day,uuid()),null);
 security.policies.push({...security.policies[0]});assert.equal(read('person.read_basic',i.personA),null);security.policies.pop();
 security.accounts.push({id:uuid(),person_id:i.personA,state:'active'});assert.equal(read('person.read_basic',i.personA),null);security.accounts.pop();
 db.run('UPDATE org_unit SET parent_id=? WHERE id=?',[i.unitA,i.site]);assert.equal(read('person.read_basic',i.personA),null);
});
