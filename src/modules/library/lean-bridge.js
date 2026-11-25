/* Adapter for the pinned Stage43 runtime; no changes to print/export/preview algorithms. */
(()=>{const session=new URLSearchParams(location.search).get('lcSession'),kind=new URLSearchParams(location.search).get('lcKind');
 if(!/^[0-9a-f-]{36}$/i.test(session||'')||!['sop','frv'].includes(kind)||!window.opener)return;
 const bar=document.createElement('div');bar.id='lc-editor-bar';bar.style.cssText='position:sticky;top:0;z-index:10000;background:#242e40;color:white;border-top:4px solid #e30613;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font:14px Arial,sans-serif';
 const title=document.createElement('strong');title.textContent='LEAN CENTER · '+(kind==='sop'?'Редактор СОП / TWI':'Редактор ФРВ')+' · Stage43';bar.append(title);
 const make=(id,label)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=label;b.style.cssText='padding:7px 12px;border:1px solid #bfc0c0;background:white;color:#242e40;border-radius:3px;cursor:pointer';bar.append(b);return b};
 const send=make('lc-editor-send','Передать в Lean Center'),download=make('lc-editor-download','Скачать JSON'),status=document.createElement('span');status.id='lc-editor-status';status.textContent='Ожидание загрузки…';bar.append(status);document.body.prepend(bar);
 let loaded=false,busy=false;
 if(kind==='frv'){for(const el of document.querySelectorAll('.tab-btn:not([data-tab="frvstudy"])'))el.style.display='none'}
 send.disabled=true;download.disabled=true;
 const tell=(type,extra={})=>window.opener?.postMessage({protocol:'lean-editor-v1',session,type,...extra},'*');
 const say=(s)=>{status.textContent=s};
 // This is a disposable editor work copy. The center owns publication,
 // review and the shared library. Original Stage43 files stay untouched.
 for(const el of document.querySelectorAll('[data-tab="documents"],#docPublishBtn,#docArchiveBtn,#docChooseFolderBtn,#docSyncFolderBtn,#docNewBtn,#docNewVersionCurrentBtn,#documentLockNewVersionBtn'))el.style.display='none';
 async function load(text,defaults){
  if(loaded||busy)return;
  busy=true;
  try{
   if(typeof stage37DraftDecisionPending!=='undefined'&&stage37DraftDecisionPending){
    if(!confirm('В этом рабочем окне есть сохранённый черновик. Восстановить его вместо исходной версии из центра?'))throw Error('Найден защищённый черновик. Сначала восстановите его или скачайте исходный текст через баннер.');
    await applyDraft(JSON.parse(stage37InitialDraft.raw));stage37DraftDecisionPending=false;$('draftBanner')?.classList.add('hidden');saveDraft();
    if(kind==='frv')document.querySelector('[data-tab="frvstudy"]')?.click();
    loaded=true;send.disabled=false;download.disabled=false;say('Рабочая копия готова · черновик восстановлен.');tell('loaded');return
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
   if(kind==='frv'){const tab=document.querySelector('[data-tab="frvstudy"]');tab?.click()}else document.querySelector('[data-tab="editor"]')?.click();
   loaded=true;send.disabled=false;download.disabled=false;say('Рабочая копия готова. Передача не публикует документ.');tell('loaded')
  }catch(e){console.error('Lean Center editor load',e);say('Ошибка загрузки: '+e.message+' · закройте окно и сохраните исходный файл');tell('error',{message:e.message})}finally{busy=false}
 }
 async function exportText(){
  if(kind==='sop'){htmlFieldToState();if(typeof htmlToTwi==='function')htmlToTwi();const dm=state.documentManager||{},snapshot=docSnapshot();const pack=await docBuildPortableJson({id:dm.currentId||null,status:'Черновик',number:state.meta.sopNumber||'Черновик',seqNo:dm.seqNo||null,deptCode:dm.deptCode||'',year:dm.year,version:dm.version,snapshot},{preferActive:true});return JSON.stringify(pack,null,2)}
  frvStudySyncFields();await frvStudyFlush();return JSON.stringify(frvStudyExport(),null,2)
 }
 async function act(toCenter){
  if(!loaded||busy)return;busy=true;send.disabled=true;download.disabled=true;
  try{const text=await exportText();if(toCenter){tell('source',{kind,text});say('Передано. Подтвердите сохранение в основном окне Lean Center.')}
   else{const u=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='LeanCenter-'+kind+'-'+session+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);say('JSON сформирован. Проверьте загрузку файла.')}
  }catch(e){say('Не удалось передать: '+e.message)}finally{busy=false;send.disabled=false;download.disabled=false}
 }
 send.onclick=()=>act(true);download.onclick=()=>act(false);
 window.addEventListener('message',e=>{const m=e.data;if(e.source!==window.opener||m?.protocol!=='lean-editor-v1'||m.session!==session)return;if(m.type==='load')load(m.text,m.defaults);if(m.type==='result')say(String(m.message||''))});
 tell('ready');
})();
