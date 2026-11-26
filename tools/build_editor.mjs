import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {MAX_SOP_KEY_MOMENTS} from '../src/modules/library/sop-limits.js';
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
 // Preserve extended KM lists through Stage42 normalization/export, but use
 // one native add button and one handler for the full existing 60-KM limit.
 replace("s.keyMoments.map(String).slice(0,3)",`s.keyMoments.map(String).slice(0,${MAX_SOP_KEY_MOMENTS})`);
 if(html.split('s.keyMoments.length<3').length!==3)throw Error('KM editor anchors changed');
 html=html.replaceAll('s.keyMoments.length<3','s.keyMoments.length<'+MAX_SOP_KEY_MOMENTS);
 replace("    const cards=document.querySelectorAll('#stepsContainer .step-card');\n    cards.forEach((card,i)=>{\n      const step=state.steps[i];\n      if(!step||step.keyMoments.length<3||step.keyMoments.length>=60)return;\n      const first=card.querySelector('[data-km=\"'+step.id+'\"]');\n      const area=first?.parentElement?.parentElement;\n      if(!area||area.querySelector('[data-stage42-add-more-km]'))return;\n      const btn=document.createElement('button');\n      btn.type='button';\n      btn.dataset.stage42AddMoreKm=String(step.id);\n      btn.className='text-xs text-red-700 mt-1 font-medium';\n      btn.textContent='＋ Добавить КМ';\n      btn.addEventListener('click',event=>{\n        event.preventDefault();\n        if(state.documentManager?.status==='Опубликован'||\n           state.documentManager?.status==='Архив')return;\n        if(step.keyMoments.length>=60)return;\n        step.keyMoments.push('');\n        stateChanged();\n        renderSteps();\n      });\n      area.appendChild(btn);\n    });\n",'    // Extended KM addition is handled by the native button.\n');
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
 replace("const actionRow=isPreceding?next.row:isFollowing?previous.row:null;","const ownLandscape=rd.text(9,1)==='Визуализация'&&actionRows.some(a=>a.row===10&&a.labelCol===1)&&actionRows.every(a=>a.labelCol===1&&vizRows.has(a.row-1));\n      const ownPortrait=rd.text(15,2)==='Визуализация'&&actionRows.some(a=>a.row===16&&a.labelCol===2)&&actionRows.every(a=>a.labelCol===2&&vizRows.has(a.row-1));\n      if(ownLandscape||ownPortrait){\n        const group=anchors.filter(a=>a.row===row+1),lane=(ownLandscape?[[2,4],[5,8],[9,10],[11,13]]:[[3,5],[6,9],[10,12]]).find(([a,b])=>col>=a&&col<=b),chosen=vizRows.has(row)&&lane?group.find(a=>a.col===lane[0]):null;\n        const index=chosen?steps.findIndex(x=>x.source.action===stage42CellAddress(chosen.row,chosen.col)):-1;\n        if(index>=0){const old=steps[index].photoIndex;if(old>=0){media[old].assigned=-1;media[old].auxiliary=true}record.assigned=index;steps[index].photoIndex=media.length}else if(row<(ownLandscape?9:15)){record.auxiliary=true;record.serviceImage=true;}\n        media.push(record);continue;\n      }\n      const actionRow=isPreceding?next.row:isFollowing?previous.row:null;");
 replace("'</b><span class=\"text-xs text-slate-500 ml-2\">Записано: '+","'</b><span data-lc-cycle-summary class=\"text-xs text-slate-500 ml-2\">Записано: '+");
 replace("const d=ensureFrvStudy(),ins=frvStudyInsights(d);\n  const fmt=","const d=ensureFrvStudy(),ins=frvStudyInsights(d);\n  for(const [i,c] of d.cycles.entries()){const e=document.querySelector('[data-frvs-cycle=\"'+i+'\"] [data-lc-cycle-summary]');if(e)e.textContent='Записано: '+frvStudyTotal(c).toFixed(1)+' сек'+(frvStudyCycleComplete(c)?' · все замеры заполнены':' · есть незаполненные замеры')}\n  const fmt=");
 replace("const obs=sheet('Наблюдения',[12,15,14,55,18,25,24,38,13,13]);","const obs=sheet('Наблюдения',[12,15,14,55,18,25,24,38,13,13,35]);");
 replace("'Время только по реально измеренным действиям (сек). Пустое — замер отсутствует.',10);","'Время только по реально измеренным действиям (сек). Пустое — замер отсутствует.',11);");
 replace("'Тип времени','Вид потери','Комментарий','Перем., м','В проект СОП']);","'Тип времени','Вид потери','Комментарий','Перем., м','В проект СОП','Причина потери']);");
 replace("o.standardCandidate?'Да':'Нет'],rowNum%2===1);","o.standardCandidate?'Да':'Нет',o.causeCode||''],rowNum%2===1);");
 replace("obs.autoFilter={from:'A5',to:'J'+Math.max(6,rowNum)};","obs.autoFilter={from:'A5',to:'K'+Math.max(6,rowNum)};");
 replace('Автосохранение действует в этом браузере. Для защиты от очистки браузера периодически сохраняйте XLSX и JSON на диск.','Рабочая копия ФРВ хранится отдельно от каталога, если память браузера доступна. После F5 снова откройте тот же ФРВ и восстановите копию. Проверяйте статус и сохраняйте JSON на диск.');
 replace("d.status=errors.length?'Observed':'Validated';","d.status=errors.length?'Observed':'Validated';setVal('frvs-status',d.status);");
 replace("d.validation=null;\n      saveDraftDebounced();frvStudyQueuePersist();renderFrvStudyDashboardOnly();","if(d.validation&&d.status==='Validated'){d.status='Observed';setVal('frvs-status',d.status)}d.validation=null;\n      saveDraftDebounced();frvStudyQueuePersist();renderFrvStudyDashboardOnly();");
 // Native-template header artwork is explicitly marked and cannot be bound as a working step photo.
 replace("if(index>=p.media.length||index< -1)return;","if(index>=p.media.length||index< -1||index>=0&&p.media[index].serviceImage)return;");
 replace("p.media.map((m,i)=>'<option value=\"'+i+'\">'+stage42Esc(m.source)+","p.media.map((m,i)=>m.serviceImage?'':'<option value=\"'+i+'\">'+stage42Esc(m.source)+");
 replace("m.auxiliary?'Служебный фон (дублирующий слой Excel)'","m.serviceImage?'Служебное изображение шапки (логотип / знак безопасности)':m.auxiliary?'Служебный фон (дублирующий слой Excel)'");
 replace("'</small><button type=\"button\" data-stage42-pick-photo=\"'+i+'\">К выбранному шагу</button></div>';","'</small><button type=\"button\" '+(m.serviceImage?'disabled title=\"Служебное изображение шаблона\" ':'')+'data-stage42-pick-photo=\"'+i+'\">К выбранному шагу</button></div>';");
 // LC6.7.6: literal responsibility statement, only on the SOP worksheet.
 replace('    // === ФРВ: геометрия и подписи как в исходном шаблоне ===',`    const responsibilityRow=ws.rowCount+1;
    M(responsibilityRow,orientation==='landscape'?1:2,responsibilityRow,orientation==='landscape'?13:12,'Ответственность за поддержание в рабочем состоянии СОП возлагается на ДОЛЖНОСТЬ',{font:{size:11},alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
    ws.getRow(responsibilityRow).height=30;
    ws.pageSetup.printArea=orientation==='landscape'?'A1:M'+responsibilityRow:'A1:M'+responsibilityRow;
    // === ФРВ: геометрия и подписи как в исходном шаблоне ===`);
 replace('</head>','<style id="lc-editor-style">'+editorCSS+'</style>\n</head>');
 replace('</body>','<script>\n'+bridge.replace(/<\/script/gi,'<\\/script')+'\n</script>\n</body>');
 return html
}
