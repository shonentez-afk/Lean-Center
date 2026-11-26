import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSaveState} from '../src/ui/cloud-save-state.js';
test('saved only when no outstanding work or exchange error',()=>{
 assert.equal(cloudSaveState().kind,'saved');
 assert.equal(cloudSaveState({readonly:true}).text,'Только чтение · база получена');
 for(const flags of [{pending:1},{conflicts:1},{dirty:true},{editorOpen:true},{preview:true},{saving:true},{offline:true},{exchangeFailed:true},{checking:true},{saveFailed:true}])assert.notEqual(cloudSaveState(flags).kind,'saved');
});
test('offline and errors retain queue count, and conflict/draft take priority',()=>{
 assert.deepEqual(cloudSaveState({offline:true,pending:3}),{kind:'offline',text:'Нет связи · локальная очередь: 3'});
 assert.equal(cloudSaveState({pending:3,syncing:true}).kind,'syncing');
 assert.equal(cloudSaveState({pending:3,exchangeFailed:true}).kind,'error');
 assert.equal(cloudSaveState({dirty:true,pending:3,syncing:true}).kind,'dirty');
 assert.equal(cloudSaveState({conflicts:1,offline:true,dirty:true,pending:3}).kind,'conflict');
});
