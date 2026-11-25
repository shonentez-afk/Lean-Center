/* Adapter for the pinned Stage43 runtime; no changes to print/export/preview algorithms. */
(()=>{const context=window.LC_EDITOR_CONTEXT||{},session=context.session,kind=context.kind,host=window.parent!==window?window.parent:null;
 if(!/^[0-9a-f-]{36}$/i.test(session||'')||!['sop','frv'].includes(kind)||!host)return;
 const bar=document.createElement('div');bar.id='lc-editor-bar';bar.style.cssText='position:sticky;top:0;z-index:10000;background:#242e40;color:white;border-top:4px solid #e30613;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font:14px Arial,sans-serif';
 const title=document.createElement('strong');title.textContent='LEAN CENTER · '+(kind==='sop'?'Редактор СОП / TWI':'Редактор ФРВ')+' · Stage43';bar.append(title);
 const make=(id,label)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=label;b.style.cssText='padding:7px 12px;border:1px solid #bfc0c0;background:white;color:#242e40;border-radius:3px;cursor:pointer';bar.append(b);return b};
 const send=make('lc-editor-send',kind==='frv'?'Сохранить ФРВ':context.tab==='twi'?'Сохранить план и СОП':context.tab==='frv'?'Сохранить ФРВ и СОП':'Сохранить СОП в каталог'),download=make('lc-editor-download','Скачать JSON'),status=document.createElement('span');status.id='lc-editor-status';status.textContent='Ожидание загрузки…';bar.append(status);document.body.prepend(bar);
 // The old Stage43 header is hidden by the center theme. Move the original
 // controls (and their existing listeners) into the integrated toolbar.
 const aiModel=document.getElementById('modelSelector'),aiBadge=document.getElementById('aiConnectivityBadge'),aiTest=document.getElementById('aiTestBtn');
 const aiPanel=document.createElement('div');aiPanel.id='lc-editor-ai';aiPanel.setAttribute('role','group');aiPanel.setAttribute('aria-label','Подключение ИИ');
 if(aiTest){aiTest.type='button';aiPanel.append(aiTest)}
 if(aiBadge){aiBadge.setAttribute('role','status');aiPanel.append(aiBadge)}
 if(aiModel){aiModel.setAttribute('aria-label','Модель ИИ');aiPanel.append(aiModel)}
 const aiNotice=document.createElement('span');aiNotice.className='lc-ai-notice';aiNotice.textContent='ИИ: Yandex Cloud по команде';aiNotice.title='При запуске функции ИИ необходимые данные текущей задачи отправляются в Yandex Cloud. Используйте только разрешённые организацией данные.';aiPanel.append(aiNotice);bar.append(aiPanel);
 // Stage43 notifications are fixed inside the iframe, not the outer page.
 // Keep them below the actual sticky toolbar, including wrapped rows.
 function syncToastPosition(){const bottom=bar.getBoundingClientRect().bottom;document.documentElement.style.setProperty('--lc-toast-top',Math.max(12,Math.ceil(bottom)+12)+'px')}
 syncToastPosition();
 if(typeof ResizeObserver==='function')new ResizeObserver(syncToastPosition).observe(bar);
 window.addEventListener('resize',syncToastPosition);
 window.addEventListener('scroll',syncToastPosition,{passive:true});
 let loaded=false,busy=false,people=[],links=[];
 const staticFields={
  'meta-approver-name':{slot:'approver',label:'Утверждающий',post:'meta-approver-post'},
  'frv-observers':{slot:'sop_observer',label:'Наблюдатель ФРВ',multiple:true},
  'twi-trainer':{slot:'trainer',label:'Инструктор / наставник',roles:['instructor','mentor']},
  'twi-trainee':{slot:'trainee',label:'Обучаемый',roles:['trainee']},
  'frvs-operator':{slot:'operator',label:'Исполнитель'},
  'frvs-observer':{slot:'observer',label:'Наблюдатель'}
 };
 function fieldSpec(f){
  if(staticFields[f.id])return staticFields[f.id];
  if(f.hasAttribute('data-resp'))return {slot:'workgroup:'+f.dataset.resp,label:'Участник рабочей группы'};
  if(f.hasAttribute('data-agn'))return {slot:'agree:'+f.dataset.agn,label:'Согласующий',postSelector:'[data-agp="'+f.dataset.agn+'"]'};
  return null
 }
 function slotField(slot){
  const entry=Object.entries(staticFields).find(([,v])=>v.slot===slot);if(entry)return document.getElementById(entry[0]);
  const m=/^(workgroup|agree):(\d+)$/.exec(slot);if(!m)return null;
  return document.querySelector((m[1]==='workgroup'?'[data-resp="':'[data-agn="')+m[2]+'"]')
 }
 const postField=spec=>spec.post?document.getElementById(spec.post):spec.postSelector?document.querySelector(spec.postSelector):null;
 function currentLinks(){
  return links.filter(x=>{
   if(!x||typeof x.slot!=='string'||typeof x.person_id!=='string'||typeof x.display_name!=='string')return false;
   const f=slotField(x.slot);if(!f)return false;const spec=fieldSpec(f);if(!spec)return false;
   return (spec.multiple?f.value.split(/\r?\n/).includes(x.display_name):f.value===x.display_name)&&(!postField(spec)||postField(spec).value===x.position)
  })
 }
 function setField(f,v){f.value=v;f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}))}
 function choosePerson(field,spec,p){
  if(!field.isConnected)return;links=currentLinks();
  if(!p){if(spec.multiple)return;links=links.filter(x=>x.slot!==spec.slot);setField(field,'');const post=postField(spec);if(post)setField(post,'');say('Выбор сотрудника очищен.');return}
  if(spec.multiple){
   if(field.value.split(/\r?\n/).includes(p.display_name)){if(!links.some(x=>x.slot===spec.slot&&x.person_id===p.id)){say('Такое ФИО уже есть в списке. Уточните сотрудника вручную.');return}}
   else setField(field,[field.value.trim(),p.display_name].filter(Boolean).join('\n'));
  }else{links=links.filter(x=>x.slot!==spec.slot);setField(field,p.display_name)}
  const post=postField(spec);if(post)setField(post,p.position||'');
  if(!links.some(x=>x.slot===spec.slot&&x.person_id===p.id))links.push({slot:spec.slot,person_id:p.id,employee_code:p.employee_code,display_name:p.display_name,position:p.position||'',unit:p.unit||''});
  say('Выбран сотрудник: '+p.display_name);
 }
 function attachPickers(){
  for(const field of document.querySelectorAll('#meta-approver-name,#frv-observers,#twi-trainer,#twi-trainee,#frvs-operator,#frvs-observer,[data-resp],[data-agn]')){
   const spec=fieldSpec(field);if(!spec||field.dataset.lcPersonPicker)continue;
   field.dataset.lcPersonPicker='1';const b=document.createElement('button');b.type='button';b.className='lc-person-button';b.textContent='Выбрать ▾';b.setAttribute('aria-label','Выбрать: '+spec.label);b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');
   if(spec.roles){field.readOnly=true;field.title='Выбор из действующих назначений ролей центра. Импортированное ФИО сохраняется до явного изменения.'}
   b.onclick=()=>{if(field.disabled)return;LCPeoplePicker.openPeopleDropdown(b,{people:()=>people,allowed:spec.roles||null,optional:!spec.multiple,label:spec.label,selectedId:currentLinks().find(x=>x.slot===spec.slot)?.person_id||'',onChoose:p=>choosePerson(field,spec,p)})};field.after(b)
  }
 }
 // A manual edit invalidates the corresponding selection even if a name is retyped.
 // Save historical print fields, never resolve an identity just from its name.
 document.addEventListener('input',e=>{const f=e.target,spec=fieldSpec(f);if(spec)links=links.filter(x=>x.slot!==spec.slot||(spec.multiple&&f.value.split(/\r?\n/).includes(x.display_name)));else if(f.id==='meta-approver-post')links=links.filter(x=>x.slot!=='approver');else if(f.hasAttribute('data-agp'))links=links.filter(x=>x.slot!=='agree:'+f.dataset.agp)},true);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-rm-resp],[data-rma]');if(!b)return;const type=b.hasAttribute('data-rm-resp')?'workgroup':'agree',idx=Number(type==='workgroup'?b.dataset.rmResp:b.dataset.rma);
  links=links.flatMap(x=>{const m=new RegExp('^'+type+':(\\d+)$').exec(x.slot);if(!m)return [x];const n=Number(m[1]);return n===idx?[]:[n>idx?{...x,slot:type+':'+(n-1)}:x]})
 },true);
 for(const id of ['respContainer','agreedContainer']){const c=document.getElementById(id);if(c)new MutationObserver(attachPickers).observe(c,{childList:true,subtree:true})}
 function applyTheme(mode){document.documentElement.dataset.lcTheme=mode==='dark'?'dark':'light'}

 const targetTab=kind==='frv'?'frvstudy':['twi','frv'].includes(context.tab)?context.tab:'editor';
 const allowed=kind==='frv'||context.tab?new Set([targetTab]):new Set(['editor','frv','preview','checklist','twi']);
 for(const b of document.querySelectorAll('.tab-btn'))if(!allowed.has(b.dataset.tab))b.style.display='none';
 const tabs=document.querySelector('[role=tablist]');if(allowed.size===1&&tabs)tabs.style.display='none';
 const frvTab=document.querySelector('[data-tab="frv"]');if(frvTab)frvTab.textContent='ФРВ по СОП';
 const twiTab=document.querySelector('[data-tab="twi"]');if(twiTab)twiTab.textContent='План TWI';
 // Independent research is owned by the center. Internal local-library commands
 // are not another authoritative library.
 for(const id of ['frvStudyNewBtn','frvStudyOpenBtn','frv36SaveConflictCopyBtn','frvStudyRestoreBtn','frvStudyRestoreJsonBtn']){const x=document.getElementById(id);if(x)x.style.display='none'}
 const transferBtn=document.getElementById('frvStudySendSopBtn');if(transferBtn){transferBtn.textContent='Сохранить ФРВ для передачи в СОП';transferBtn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();act(true)},true)}

 send.disabled=true;download.disabled=true;
 const tell=(type,extra={})=>host.postMessage({protocol:'lean-editor-v1',session,type,...extra},'*');
 const say=(s)=>{status.textContent=s};
 // This is a disposable editor work copy. The center owns publication,
 // review and the shared library. Original Stage43 files stay untouched.
 for(const el of document.querySelectorAll('[data-tab="documents"],#docPublishBtn,#docArchiveBtn,#docChooseFolderBtn,#docSyncFolderBtn,#docNewBtn,#docNewVersionCurrentBtn,#documentLockNewVersionBtn'))el.style.display='none';
 async function load(text,defaults){
  if(loaded||busy)return;
  busy=true;
  try{
   people=Array.isArray(defaults?.people)?defaults.people:[];applyTheme(defaults?.theme);
   if(text){const raw=JSON.parse(text);const stored=kind==='sop'?raw.constructor?.leanCenterPeople:raw.study?.leanCenterPeople;links=Array.isArray(stored)?stored:[]}
   if(typeof stage37DraftDecisionPending!=='undefined'&&stage37DraftDecisionPending){
    if(!confirm('В этом рабочем окне есть сохранённый черновик. Восстановить его вместо исходной версии из центра?'))throw Error('Найден защищённый черновик. Сначала восстановите его или скачайте исходный текст через баннер.');
    await applyDraft(JSON.parse(stage37InitialDraft.raw));stage37DraftDecisionPending=false;$('draftBanner')?.classList.add('hidden');saveDraft();
    if(kind==='frv'){document.querySelector('[data-tab="frvstudy"]')?.click();const passport=document.getElementById('frvs-studyId')?.closest('details');if(passport)passport.open=true}
    attachPickers();loaded=true;send.disabled=false;download.disabled=false;say('Рабочая копия готова · черновик восстановлен.');tell('loaded');return
   }
   if(text){
    const p=JSON.parse(text);
    if(kind==='sop'){
     const docId='LC-'+session,s=p.constructor,d=p.document;
     await docRestorePortablePhotos(docId,s,p.photoAssets);
     docLoadToState({id:docId,status:'Черновик',deptCode:d.deptCode||'',year:d.year,version:d.version,seqNo:d.seqNo,number:d.number,title:s.meta?.operation,snapshot:s,createdAt:d.createdAt,createdBy:d.createdBy});
     const result=await restoreStepPhotos(state.steps,docId);if(result.lost)throw Error('Не удалось восстановить все фото');
     renderSteps();applyDocumentLock();saveDraft();
    }else{const d=frv34RestoreExport(p);d.aiClassifications=p.aiClassifications||[];d.libraryId='LC-'+session;await frvStudySwitchTo(d)}
   }else if(kind==='sop'){
    if(defaults?.operation){state.meta.operation=defaults.operation;setVal('meta-operation',defaults.operation)}
    if(defaults?.unit){state.meta.department=defaults.unit;setVal('meta-department',defaults.unit)}
   }else if(defaults?.operation){const d=ensureFrvStudy();d.operationId=defaults.operation;renderFrvStudy()}
   if(kind==='frv'){const tab=document.querySelector('[data-tab="frvstudy"]');tab?.click();const passport=document.getElementById('frvs-studyId')?.closest('details');if(passport)passport.open=true}else document.querySelector('[data-tab="'+targetTab+'"]')?.click();
   attachPickers();loaded=true;send.disabled=false;download.disabled=false;say('Рабочая копия готова. Передача не публикует документ.');tell('loaded')
  }catch(e){console.error('Lean Center editor load',e);say('Ошибка загрузки: '+e.message+' · закройте окно и сохраните исходный файл');tell('error',{message:e.message})}finally{busy=false}
 }
 async function exportText(){
  if(kind==='sop'){htmlFieldToState();if(typeof htmlToTwi==='function')htmlToTwi();const dm=state.documentManager||{},snapshot=docSnapshot();if(snapshot.twi)snapshot.twi.enabled=twiHasGeneratedContent(snapshot.twi);snapshot.leanCenterPeople=currentLinks();const pack=await docBuildPortableJson({id:dm.currentId||null,status:'Черновик',number:state.meta.sopNumber||'Черновик',seqNo:dm.seqNo||null,deptCode:dm.deptCode||'',year:dm.year,version:dm.version,snapshot},{preferActive:true});return JSON.stringify(pack,null,2)}
  frvStudySyncFields();await frvStudyFlush();const pack=frvStudyExport();pack.study.leanCenterPeople=currentLinks();return JSON.stringify(pack,null,2)
 }
 async function act(toCenter){
  if(!loaded||busy)return;busy=true;send.disabled=true;download.disabled=true;
  try{const text=await exportText();if(toCenter){tell('source',{kind,text});say('Передано. Подтвердите сохранение в библиотеке Lean Center.')}
   else{const u=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='LeanCenter-'+kind+'-'+session+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);say('JSON сформирован. Проверьте загрузку файла.')}
  }catch(e){say('Не удалось передать: '+e.message)}finally{busy=false;send.disabled=false;download.disabled=false}
 }
 // Local, transparent TWI draft from SOP only. No network request; keep the
 // proven Stage43 per-field proposal comparison and manual-edit preservation.
 async function localTwi(){
  if(!loaded)return;
  htmlFieldToState();const src=twiSopInput(),steps=src.steps.filter(s=>String(s.action||'').trim());
  if(!steps.length){say('Сначала заполните шаги СОП.');return}
  const action=steps.map(s=>s.stepNumber+'. '+s.action).join('\n');
  const keys=steps.map(s=>s.stepNumber+'. '+s.action+' — '+(s.keyPoints.join('; ')||'Ключевые моменты уточнить')).join('\n');
  const reasons=steps.map(s=>s.stepNumber+'. '+s.action+' — '+(s.reason||'Причину уточнить')).join('\n');
  const current=state.twi||{};
  const proposal={
   prepare:{purpose:'Научить правильно выполнять операцию «'+(src.operation||'по СОП')+'».',known:'Уточнить опыт и исходные навыки обучаемого.',prep:[src.workplace?'Рабочее место: '+src.workplace:'Уточнить рабочее место.',src.safety?'Требования СОП: '+src.safety:'Уточнить требования безопасности.',state.meta?.tools?'Инструмент: '+state.meta.tools:'',state.meta?.material?'Материал: '+state.meta.material:''].filter(Boolean).join('\n'),interest:'Объяснить назначение операции и ожидаемый результат.'},
   present:{round1:'Показать операцию целиком в нормальном темпе:\n'+action,round2:'Показать и назвать основные шаги и ключевые моменты:\n'+keys,round3:'Повторить демонстрацию с объяснением причин:\n'+reasons},
   tryOut:{perform:'Дать обучаемому выполнить операцию. Затем повторить, называя шаги:\n'+action,explain:'При следующих повторениях обучаемый называет ключевые моменты и объясняет причины:\n'+keys+'\n'+reasons,check:'Проверить выполнение всех шагов и ключевых моментов СОП. Зафиксировать фактический результат, не допускать автоматически.',correct:'Остановить опасное или неправильное действие, показать верный способ и дать повторить.'},
   followUp:{help:'Назначить ответственного за поддержку.',control:'Указать график последующих проверок в плане обучения.',observe:'Наблюдать соблюдение требований СОП и устойчивость самостоятельного выполнения.',close:'Зафиксировать фактический результат проверки и решение ответственного.'}
  };
  let chosen=new Set(TWI_GENERATED_FIELDS.map(twiFieldId));
  if(twiHasGeneratedContent(current)){const diff=twiProposalDiff(current,proposal);if(diff.length){const pending=twiShowPreview(diff);for(const el of document.querySelectorAll('#twiGenerationPreview b,#twiGenerationPreview p'))el.textContent=el.textContent.replaceAll('Предложение ИИ','Локальное предложение').replaceAll('предложения ИИ','предложения');const picked=await pending;if(!picked||!picked.size)return;chosen=picked}else chosen=new Set()}
  state.twi=twiCommitProposal(current,proposal,chosen);twiToHtml();saveDraft();say('Черновик плана TWI сформирован по СОП. Проверьте и дополните его перед сохранением.')
 }
 const gen=document.getElementById('generateTwiBtn');
 if(gen){
  gen.textContent='Сформировать план из СОП (без ИИ)';
  const cloud=document.createElement('button');cloud.id='lc-generate-twi-ai';cloud.type='button';cloud.className=gen.className;cloud.textContent='Сформировать с ИИ';gen.after(cloud);
  gen.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();if(!loaded)return;gen.disabled=true;cloud.disabled=true;try{await localTwi()}catch(err){say(err.message)}finally{gen.disabled=false;cloud.disabled=false}},true);
  cloud.onclick=async()=>{if(!loaded||gen.disabled||cloud.disabled)return;cloud.disabled=true;gen.disabled=true;try{htmlFieldToState();htmlToTwi();await generateTwiPlan()}catch(err){say(err.message)}finally{gen.disabled=false;cloud.disabled=false}};
 }
 send.onclick=()=>act(true);download.onclick=()=>act(false);
 window.addEventListener('message',e=>{const m=e.data;if(e.source!==host||m?.protocol!=='lean-editor-v1'||m.session!==session)return;if(m.type==='load')load(m.text,m.defaults);if(m.type==='result')say(String(m.message||''));if(m.type==='theme')applyTheme(m.theme);if(m.type==='directory'){people=Array.isArray(m.people)?m.people:[];applyTheme(m.theme);LCPeoplePicker.refreshPeopleDropdown()}});
 tell('ready');
})();
