import {rows,one} from '../../core/primitives.js';
import {recordedBusinessDate} from '../../core/business-clock.js';
export function actionCompletionDates(db){
 const map=new Map();
 for(const e of rows(db,"SELECT entity_id,occurred_at,json_extract(payload_json,'$.business_offset_minutes') offset FROM change_event WHERE entity_type='action_item' AND json_extract(payload_json,'$.command')='implement' ORDER BY expected_revision,id")){
  map.set(e.entity_id+'|'+e.occurred_at,recordedBusinessDate(e.occurred_at,e.offset));
 }
 return map
}
export function actionCompletionDate(db,a,dates=null){
 if(!a.implemented_at)return recordedBusinessDate(null);
 const key=a.id+'|'+a.implemented_at;
 if(dates)return dates.get(key)||recordedBusinessDate(a.implemented_at);
 const e=one(db,"SELECT json_extract(payload_json,'$.business_offset_minutes') offset FROM change_event WHERE entity_type='action_item' AND entity_id=? AND occurred_at=? AND json_extract(payload_json,'$.command')='implement' ORDER BY expected_revision DESC,id DESC LIMIT 1",[a.id,a.implemented_at]);
 return recordedBusinessDate(a.implemented_at,e?.offset)
}

// New verifications use the calendar of implementation, not the viewer's timezone.
// Older verification events keep the historical UTC predicate during replay.
export const ACTION_VERIFY_DATE_BASIS='implementation-civil-v1';
export function actionEvidenceDay(db,a,basis=ACTION_VERIFY_DATE_BASIS){
 return basis===ACTION_VERIFY_DATE_BASIS?actionCompletionDate(db,a).date:a.implemented_at?.slice(0,10)||''
}
export function actionVerificationBasis(db,id){
 const e=one(db,"SELECT json_extract(payload_json,'$.verification_date_basis') basis FROM change_event WHERE id=? AND entity_type='action_item'",[id]);
 return e?.basis===ACTION_VERIFY_DATE_BASIS?ACTION_VERIFY_DATE_BASIS:'legacy-utc'
}
