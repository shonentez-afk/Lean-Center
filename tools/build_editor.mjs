import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const BASE='baselines/sop-stage43/releases/stage43-sop-print-formats-20261125.html';
export function buildEditor(bridge){
 const bytes=execFileSync('git',['show','HEAD:'+BASE],{maxBuffer:10*1024*1024});
 // Pin the exact accepted artifact (Git blob hash includes the blob header).
 const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 if(sha!=='5e35036ce243fed74ea018ac8eaf5f6c4a3c3e45')throw Error('Stage43 baseline changed: '+sha);
 let html=bytes.toString('utf8');
 const replace=(old,next)=>{if(html.split(old).length!==2)throw Error('Stage43 adapter anchor changed: '+old.slice(0,80));html=html.replace(old,()=>next)};
 replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="connect-src data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n<script>window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */</script>');
 // Isolate editor working copies by session so the original standalone
 // SOP editor's draft and photo library cannot be overwritten.
 replace("const DRAFT_KEY='sop-builder-draft-v3';","const LC_EDITOR_SESSION=window.LC_EDITOR_CONTEXT?.session||'isolated';\nconst DRAFT_KEY='lean-editor-draft-'+LC_EDITOR_SESSION;");
 replace("const LEGACY_DRAFT_KEYS=['sop-builder-draft-v2','sop-builder-draft-v1'];","const LEGACY_DRAFT_KEYS=[];");
 replace("const DOC_DB_NAME='sop-document-manager-db-v1',","const DOC_DB_NAME='lean-editor-doc-'+LC_EDITOR_SESSION,");
 replace("const IDB_NAME='sop-builder-db-v3',","const IDB_NAME='lean-editor-photo-'+LC_EDITOR_SESSION,");
 replace("const LEGACY_IDB_NAMES=['sop-builder-db-v2','sop-builder-db'];","const LEGACY_IDB_NAMES=[];");
 replace("const FRV34_DB='SOP_FRV_Research_v1',","const FRV34_DB='lean-editor-frv-'+LC_EDITOR_SESSION,");
 replace("const FRV35_ACTIVE_ID_KEY='sop-frv-active-study-id-v1';","const FRV35_ACTIVE_ID_KEY='lean-editor-frv-active-'+LC_EDITOR_SESSION;");
 // Do not send corporate content outside the offline editor. Keep the
 // deterministic check, import, photo tools and exports intact.
 replace("initDocumentManager();pingAI()","initDocumentManager();");
 // Preserve five text entries in the derived editor without changing the baseline.
 replace("s.keyMoments.map(String).slice(0,3)","s.keyMoments.map(String).slice(0,5)");
 if(html.split('s.keyMoments.length<3').length!==3)throw Error('KM editor anchors changed');
 html=html.replaceAll('s.keyMoments.length<3','s.keyMoments.length<5');
 replace("ws.getCell(5,7).value={formula:timeCellRefs.join('+')}","ws.getCell(5,7).value={formula:timeCellRefs.join('+'),result:exportData.totalTimeSeconds/86400}");
 replace('</body>','<script>\n'+bridge.replace(/<\/script/gi,'<\\/script')+'\n</script>\n</body>');
 return html
}
