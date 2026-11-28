// LC8.2.1: personal inbox over the existing LC8.3 recipient journal.
// No delivery, no inferred workflow transitions, no second task registry.
import {one,rows,isId} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {approvalNoticeView} from './sop-approval.mjs';
import {familiarizationNoticeView} from './sop-familiarization.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const exists=(db,t)=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]);
const journal='lc83_sop_notice',readTable='lc82_notice_read';
const schema="CREATE TABLE IF NOT EXISTS lc82_notice_read(notice_id TEXT PRIMARY KEY REFERENCES lc83_sop_notice(id),account_id TEXT NOT NULL REFERENCES lc81_account(id),read_at TEXT NOT NULL);";
export const notificationsEnabled=()=>process.env.LC82_INBOX_ENABLED!=='0';
function requireInbox(a){must(notificationsEnabled()&&a.personId,404,'Личные уведомления недоступны')}
function sourceRows(db,a){
 if(!exists(db,journal))return [];
 const read=exists(db,readTable);
 return rows(db,'SELECT n.*,n.rowid ordinal,'+(read?'r.read_at':'NULL read_at')+' FROM lc83_sop_notice n '+(read?'LEFT JOIN lc82_notice_read r ON r.notice_id=n.id AND r.account_id=n.recipient_account_id ':'')+'WHERE n.recipient_account_id=? ORDER BY n.occurred_at DESC,n.id DESC',[a.accountId]);
}
function project(db,a,n){
 const view=n.kind.startsWith('familiarization_')?familiarizationNoticeView(db,a,n):approvalNoticeView(db,a,n);
 return view?{id:n.id,kind:n.kind,occurred_at:n.occurred_at,read_at:n.read_at,...view}:null;
}
function visible(db,a){
 return sourceRows(db,a).flatMap(n=>{const v=project(db,a,n);return v?[{n,v}]:[]});
}
const newest=(a,b)=>b.v.occurred_at.localeCompare(a.v.occurred_at)||b.v.id.localeCompare(a.v.id);
const actions=(a,b)=>Number(b.v.overdue)-Number(a.v.overdue)||String(a.v.due_on??'9999-12-31').localeCompare(String(b.v.due_on??'9999-12-31'))||newest(a,b);
export function notificationFeed(db,a,{filter='all',cursor=null,limit=30}={}){
 requireInbox(a);
 must(['all','unread','actions'].includes(filter)&&(cursor===null||isId(cursor))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,400,'Неверный фильтр уведомлений');
 const all=visible(db,a),unread=all.filter(x=>!x.v.read_at).length,actionCount=all.filter(x=>x.v.pending).length;
 // Rowid is internal append order, not a client-supplied number. A snapshot
 // is the latest currently visible owned event ID. Read-all cannot consume an
 // event appended later, including a same-millisecond event.
 const snapshot=all.reduce((best,x)=>!best||x.n.ordinal>best.n.ordinal?x:best,null)?.v.id??null;
 const selected=all.filter(x=>filter==='all'||filter==='unread'&&!x.v.read_at||filter==='actions'&&x.v.pending).sort(filter==='actions'?actions:newest);
 let start=0;
 if(cursor!==null){const i=selected.findIndex(x=>x.v.id===cursor);must(i>=0,409,'Лента изменилась. Обновите список уведомлений');start=i+1}
 const items=selected.slice(start,start+limit).map(x=>x.v);
 return {items,unread,action_count:actionCount,total:selected.length,snapshot,next_cursor:start+limit<selected.length?items.at(-1)?.id??null:null};
}
export function readNotification(db,a,f){
 requireInbox(a);must(exact(f,['id'])&&isId(f.id),400,'Неверное уведомление');
 const x=visible(db,a).find(x=>x.v.id===f.id);must(x,404,'Действие больше недоступно');
 if(!x.v.read_at){db.run(schema);db.run('INSERT OR IGNORE INTO lc82_notice_read VALUES(?,?,?)',[x.v.id,a.accountId,a.at])}
 return {id:x.v.id,read_at:x.v.read_at||a.at,route:x.v.route};
}
export function readAllNotifications(db,a,f){
 requireInbox(a);must(exact(f,['snapshot'])&&(f.snapshot===null||isId(f.snapshot)),400,'Неверный снимок ленты');
 if(f.snapshot===null)return {marked:0};
 const anchor=exists(db,journal)&&one(db,'SELECT rowid ordinal FROM lc83_sop_notice WHERE id=? AND recipient_account_id=?',[f.snapshot,a.accountId]);
 must(anchor,404,'Снимок ленты недоступен');
 const batch=visible(db,a).filter(x=>!x.v.read_at&&x.n.ordinal<=anchor.ordinal);
 if(batch.length){db.run(schema);for(const x of batch)db.run('INSERT OR IGNORE INTO lc82_notice_read VALUES(?,?,?)',[x.v.id,a.accountId,a.at])}
 return {marked:batch.length};
}
export function checkNotificationIntegrity(db){
 if(!exists(db,readTable))return;
 must(exists(db,journal)&&!one(db,'SELECT r.notice_id FROM lc82_notice_read r LEFT JOIN lc83_sop_notice n ON n.id=r.notice_id WHERE n.id IS NULL OR n.recipient_account_id<>r.account_id OR r.read_at<n.occurred_at LIMIT 1'),503,'Нарушена целостность прочтения уведомлений');
}
