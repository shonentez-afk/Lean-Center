// Idempotency receipts are private and committed with the business events.
import {one,rows,isId,canonical} from '../../src/core/primitives.js';
import {createHash} from 'node:crypto';
import {PilotError} from '../lc74-store.mjs';
export const RECEIPT_SCHEMA=`CREATE TABLE IF NOT EXISTS lc81_library_receipt(
 account_id TEXT NOT NULL REFERENCES lc81_account(id),
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_id)
);`;
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
export function requestDigest(request){
 if(!isId(request.request_id)||typeof request.text!=='string')throw new PilotError(400,'Неверный ID запроса');
 const {text,...rest}=request;
 return hash(canonical({...rest,text_sha256:hash(text)}));
}
export function getReceipt(db,account,requestId,digest){
 if(!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_library_receipt'"))return null;
 const r=one(db,'SELECT request_hash,result_json FROM lc81_library_receipt WHERE account_id=? AND request_id=?',[account,requestId]);
 if(!r)return null;
 if(r.request_hash!==digest)throw new PilotError(409,'ID уже использован с другим содержимым');
 return JSON.parse(r.result_json);
}
export function addReceipt(db,account,requestId,digest,result,at){
 db.run(RECEIPT_SCHEMA);
 if(one(db,'SELECT count(*) n FROM lc81_library_receipt').n>=10000)throw new PilotError(503,'Достигнут лимит журнала сохранения QA');
 db.run('INSERT INTO lc81_library_receipt VALUES(?,?,?,?,?)',[account,requestId,digest,canonical(result),at]);
}
