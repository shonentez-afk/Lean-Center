import {one} from '../../core/primitives.js';
import {recordedBusinessDate} from '../../core/business-clock.js';

// The journal preserves the original author's offset. No viewer timezone is
// consulted. Keep the exact legacy timestamp-prefix rule for old events.
const day=(stamp,offset)=>offset===null||offset===undefined?String(stamp||'').slice(0,10):recordedBusinessDate(stamp,offset).date;
export function scheduleCreationDate(db,s){
 if(!s.created_at)return '';
 // A replanned row has the update event ID, not the original entity ID.
 const e=one(db,`SELECT json_extract(payload_json,'$.business_offset_minutes') offset
 FROM change_event WHERE entity_type='schedule_event' AND occurred_at=? AND
 ((operation='create' AND entity_id=?) OR (operation='update' AND id=? AND json_extract(payload_json,'$.command')='replan'))
 ORDER BY expected_revision DESC,id DESC LIMIT 1`,[s.created_at,s.id,s.id]);
 return day(s.created_at,e?.offset)
}
export function trainingEnrollmentFinishDay(db,a){
 if(!a.finished_at)return '';
 const e=one(db,`SELECT json_extract(payload_json,'$.business_offset_minutes') offset
 FROM change_event WHERE entity_type='training_enrollment' AND entity_id=? AND operation='update'
 AND occurred_at=? AND json_extract(payload_json,'$.command')='finish'
 ORDER BY expected_revision DESC,id DESC LIMIT 1`,[a.id,a.finished_at]);
 return day(a.finished_at,e?.offset)
}
