import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const BASE='baselines/sop-stage43/releases/stage43-sop-print-formats-20261125.html';
export function buildEditor(bridge,editorCSS=''){
 const bytes=execFileSync('git',['show','HEAD:'+BASE],{maxBuffer:10*1024*1024});
 // Pin the exact accepted artifact (Git blob hash includes the blob header).
 const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 if(sha!=='5e35036ce243fed74ea018ac8eaf5f6c4a3c3e45')throw Error('Stage43 baseline changed: '+sha);
 let html=bytes.toString('utf8');
 const replace=(old,next)=>{if(html.split(old).length!==2)throw Error('Stage43 adapter anchor changed: '+old.slice(0,80));html=html.replace(old,()=>next)};
 replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="connect-src data: blob: https://functions.yandexcloud.net/d4ehdpoue3sve6s0f92b; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n<script>window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */</script>');
 // Isolate editor working copies by session so the original standalone
 // SOP editor's draft and photo library cannot be overwritten.
 replace("const DRAFT_KEY='sop-builder-draft-v3';","const LC_EDITOR_SESSION=window.LC_EDITOR_CONTEXT?.session||'isolated';\nconst DRAFT_KEY='lean-editor-draft-'+LC_EDITOR_SESSION;");
 replace("const LEGACY_DRAFT_KEYS=['sop-builder-draft-v2','sop-builder-draft-v1'];","const LEGACY_DRAFT_KEYS=[];");
 replace("const DOC_DB_NAME='sop-document-manager-db-v1',","const DOC_DB_NAME='lean-editor-doc-'+LC_EDITOR_SESSION,");
 replace("const IDB_NAME='sop-builder-db-v3',","const IDB_NAME='lean-editor-photo-'+LC_EDITOR_SESSION,");
 replace("const LEGACY_IDB_NAMES=['sop-builder-db-v2','sop-builder-db'];","const LEGACY_IDB_NAMES=[];");
 replace("const FRV34_DB='SOP_FRV_Research_v1',","const FRV34_DB='lean-editor-frv-'+LC_EDITOR_SESSION,");
 replace("const FRV35_ACTIVE_ID_KEY='sop-frv-active-study-id-v1';","const FRV35_ACTIVE_ID_KEY='lean-editor-frv-active-'+LC_EDITOR_SESSION;");
 // Allow only the existing Stage43 Yandex proxy; no automatic network probe.
 // AI calls are explicit user actions. Keep offline import, photo and export.
 replace("initDocumentManager();pingAI()","initDocumentManager();");
 // Preserve five text entries in the derived editor without changing the baseline.
 replace("s.keyMoments.map(String).slice(0,3)","s.keyMoments.map(String).slice(0,5)");
 if(html.split('s.keyMoments.length<3').length!==3)throw Error('KM editor anchors changed');
 html=html.replaceAll('s.keyMoments.length<3','s.keyMoments.length<5');
 replace("ws.getCell(5,7).value={formula:timeCellRefs.join('+')}","ws.getCell(5,7).value={formula:timeCellRefs.join('+'),result:exportData.totalTimeSeconds/86400}");
 // LC5.4: exact patches to the pinned runtime. Original Stage43 blob stays immutable.
 replace("modeButtons.forEach(btn=>btn.onclick=()=>{mode=btn.dataset.illMode;iconKind=null;modeButtons.forEach(x=>x.dataset.active=x===btn?'1':'0');iconButtons.forEach(x=>x.dataset.active='0');help.textContent=modeHelp[mode]||'';canvas.style.cursor=mode==='select'?'default':'crosshair'});","modeButtons.forEach(btn=>btn.onclick=()=>{mode=btn.dataset.illMode;iconKind=null;if(mode!=='select'){selected.clear();primary=-1;textInput.value='';draw()}else syncText();modeButtons.forEach(x=>x.dataset.active=x===btn?'1':'0');iconButtons.forEach(x=>x.dataset.active='0');help.textContent=modeHelp[mode]||'';canvas.style.cursor=mode==='select'?'default':'crosshair'});");
 replace("iconButtons.forEach(btn=>btn.onclick=()=>{mode='icon';iconKind=btn.dataset.illIcon;modeButtons.forEach(x=>x.dataset.active='0');iconButtons.forEach(x=>x.dataset.active=x===btn?'1':'0');help.textContent=modeHelp.icon;canvas.style.cursor='crosshair'});","iconButtons.forEach(btn=>btn.onclick=()=>{mode='icon';selected.clear();primary=-1;textInput.value='';draw();iconKind=btn.dataset.illIcon;modeButtons.forEach(x=>x.dataset.active='0');iconButtons.forEach(x=>x.dataset.active=x===btn?'1':'0');help.textContent=modeHelp.icon;canvas.style.cursor='crosshair'});");
 replace("if(s&&(s.type==='label'||s.type==='callout')){\n      s.text=value;draw();commitIllustrationEdit();","if(mode==='select'&&selected.size===1&&s&&(s.type==='label'||s.type==='callout')){\n      s.text=value;draw();commitIllustrationEdit();");
 replace("textInput.addEventListener('input',()=>{const s=shapes[primary];if(s&&(s.type==='label'||s.type==='callout')){s.text=textInput.value;draw()}});","textInput.addEventListener('input',()=>{const s=shapes[primary];if(mode==='select'&&selected.size===1&&s&&(s.type==='label'||s.type==='callout')){s.text=textInput.value;draw()}});");
 replace("textInput.addEventListener('change',commitIllustrationEdit);","textInput.addEventListener('change',()=>{if(mode==='select'&&selected.size===1)commitIllustrationEdit()});");
 replace("Выделение: обычный клик выбирает один объект, Shift+клик добавляет/убирает объект из группы.","Выделение / правка: выберите одну подпись для изменения текста; двойной клик открывает правку. Shift+клик добавляет/убирает объект из группы.");
 replace("s.durationSeconds=parseDuration(e.target.value);\n  // Automatically derived","const parsed=lc54Duration(e.target.value);e.target.setCustomValidity(parsed===null?'Введите целые секунды или ММ:СС (секунды 00–59)':'');e.target.setAttribute('aria-invalid',String(parsed===null));lc54MarkDuration(s,e.target,parsed);if(parsed===null)return;\n  s.durationSeconds=parsed;\n  // Automatically derived");
 replace(">Время</label><input type=\"text\" value=\"${escapeHtml(formatDuration(s.durationSeconds))}\" data-step-field=\"duration\"",">Время, с / ММ:СС</label><input type=\"text\" inputmode=\"numeric\" title=\"Целые секунды или ММ:СС\" value=\"${escapeHtml(formatDuration(s.durationSeconds))}\" data-step-field=\"duration\"");
 replace("const actionRow=isPreceding?next.row:isFollowing?previous.row:null;","const ownLandscape=rd.text(9,1)==='Визуализация'&&actionRows.some(a=>a.row===10&&a.labelCol===1)&&actionRows.every(a=>a.labelCol===1&&vizRows.has(a.row-1));\n      if(ownLandscape){\n        const group=anchors.filter(a=>a.row===row+1),lane=[[2,4],[5,8],[9,10],[11,13]].find(([a,b])=>col>=a&&col<=b),chosen=vizRows.has(row)&&lane?group.find(a=>a.col===lane[0]):null;\n        const index=chosen?steps.findIndex(x=>x.source.action===stage42CellAddress(chosen.row,chosen.col)):-1;\n        if(index>=0){const old=steps[index].photoIndex;if(old>=0){media[old].assigned=-1;media[old].auxiliary=true}record.assigned=index;steps[index].photoIndex=media.length}else if(row<9)record.auxiliary=true;\n        media.push(record);continue;\n      }\n      const actionRow=isPreceding?next.row:isFollowing?previous.row:null;");
 replace("'</b><span class=\"text-xs text-slate-500 ml-2\">Записано: '+","'</b><span data-lc-cycle-summary class=\"text-xs text-slate-500 ml-2\">Записано: '+");
 replace("const d=ensureFrvStudy(),ins=frvStudyInsights(d);\n  const fmt=","const d=ensureFrvStudy(),ins=frvStudyInsights(d);\n  for(const [i,c] of d.cycles.entries()){const e=document.querySelector('[data-frvs-cycle=\"'+i+'\"] [data-lc-cycle-summary]');if(e)e.textContent='Записано: '+frvStudyTotal(c).toFixed(1)+' сек'+(frvStudyCycleComplete(c)?' · все замеры заполнены':' · есть незаполненные замеры')}\n  const fmt=");
 replace("const obs=sheet('Наблюдения',[12,15,14,55,18,25,24,38,13,13]);","const obs=sheet('Наблюдения',[12,15,14,55,18,25,24,38,13,13,35]);");
 replace("'Время только по реально измеренным действиям (сек). Пустое — замер отсутствует.',10);","'Время только по реально измеренным действиям (сек). Пустое — замер отсутствует.',11);");
 replace("'Тип времени','Вид потери','Комментарий','Перем., м','В проект СОП']);","'Тип времени','Вид потери','Комментарий','Перем., м','В проект СОП','Причина потери']);");
 replace("o.standardCandidate?'Да':'Нет'],rowNum%2===1);","o.standardCandidate?'Да':'Нет',o.causeCode||''],rowNum%2===1);");
 replace("obs.autoFilter={from:'A5',to:'J'+Math.max(6,rowNum)};","obs.autoFilter={from:'A5',to:'K'+Math.max(6,rowNum)};");
 replace('Автосохранение действует в этом браузере. Для защиты от очистки браузера периодически сохраняйте XLSX и JSON на диск.','Рабочая копия ФРВ хранится отдельно от каталога, если память браузера доступна. После F5 снова откройте тот же ФРВ и восстановите копию. Проверяйте статус и сохраняйте JSON на диск.');
 replace('</head>','<style id="lc-editor-style">'+editorCSS+'</style>\n</head>');
 replace('</body>','<script>\n'+bridge.replace(/<\/script/gi,'<\\/script')+'\n</script>\n</body>');
 return html
}
