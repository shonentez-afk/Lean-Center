// The exact historical title belongs to a revision, not to the last draft.
// Deliberately independent of the aggregate core: this query is used by
// both library and training while their ES modules are being initialized.
export const REVISION_TITLE_SQL = `COALESCE(
 NULLIF(json_extract(r.payload_json,'$.title'),''),
 (SELECT NULLIF(trim(json_extract(ce.payload_json,'$.title')),'') FROM change_event ce
  WHERE ce.entity_type='document' AND ce.entity_id=r.document_id
    AND ((ce.id=r.id AND json_extract(ce.payload_json,'$.command') IN('create','revise'))
    OR (json_extract(ce.payload_json,'$.command')='save' AND json_extract(ce.payload_json,'$.revision_id')=r.id))
  ORDER BY ce.expected_revision DESC,ce.occurred_at DESC,ce.id DESC LIMIT 1),
 NULLIF(json_extract(r.payload_json,'$.projection.title'),''),d.title)`;
export function documentTitle(db,id,revisionId=null,latest=false){
 const order=latest?'r.version_no DESC':"CASE WHEN r.state='effective' THEN 0 ELSE 1 END,r.version_no DESC";
 const stmt=db.prepare(`SELECT ${REVISION_TITLE_SQL} title FROM document d LEFT JOIN document_revision r ON r.document_id=d.id
 WHERE d.id=?${revisionId?' AND r.id=?':''} ORDER BY ${order} LIMIT 1`);
 try{stmt.bind(revisionId?[id,revisionId]:[id]);return stmt.step()?stmt.getAsObject().title||'':''}finally{stmt.free()}
}
