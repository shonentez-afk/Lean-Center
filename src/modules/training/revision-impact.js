// Editorial equivalence is a documented competence-only decision, never an
// approval of the new SOP, a permission to work or a new training fact.
import {one,rows,canonical} from '../../core/primitives.js';
const exists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_revision_impact'");
export function revisionImpact(db,oldId,newId,day){
 if(!exists(db))return null;
 return one(db,`SELECT i.* FROM lc81_revision_impact i JOIN document_revision p ON p.id=i.old_id JOIN document_revision n ON n.id=i.new_id JOIN document d ON d.id=n.document_id
 WHERE i.old_id=? AND i.new_id=? AND i.reviewed_on<=? AND p.document_id=n.document_id AND p.state='superseded' AND n.state='effective' AND d.archived=0
 AND json_extract(p.payload_json,'$.source.sha256')=i.old_sha AND json_extract(n.payload_json,'$.source.sha256')=i.new_sha
 ORDER BY i.rev DESC LIMIT 1`,[oldId,newId,day])||null;
}
export function equivalentRevisions(db,day){
 if(!exists(db))return new Set();
 const entries=rows(db,`SELECT i.old_id,i.new_id FROM lc81_revision_impact i JOIN document_revision n ON n.id=i.new_id WHERE n.state='effective' AND i.reviewed_on<=? GROUP BY i.old_id,i.new_id`,[day]);
 return new Set(entries.filter(x=>revisionImpact(db,x.old_id,x.new_id,day)?.decision==='editorial').map(x=>x.old_id));
}
export function competenceRevisionCurrent(db,id,day){
 return !!id&&(!!one(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND r.state='effective' AND d.archived=0",[id])||equivalentRevisions(db,day).has(id));
}
// Only known administrative fields may be ignored. Unknown fields,
// instructions, safety, materials, tools, images, TWI plan and timing must
// be identical; a wording change in a step is not automatically editorial.
export function sameWorkContent(a,b){
 function key(raw){
  const {document,integrity,...rest}=raw;
  const src=structuredClone(rest);
  if(!src.constructor||!src.constructor.meta||!src.photoAssets)return null;
  delete src.constructor.meta.sopNumber;
  return canonical(src);
 }
 const x=key(a),y=key(b);
 return x!==null&&y!==null&&x===y;
}
