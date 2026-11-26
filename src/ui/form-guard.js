// Shared protection for explicitly registered work forms, never list filters.
// A DOM-local baseline is discarded when a new screen is built after saving.
const fieldSelector='input[name]:not([type=file]),select[name],textarea[name],button.lc-directory-trigger[name]';
export const workFields=scope=>Array.from(scope.querySelectorAll(fieldSelector));
function signature(scope){
 return JSON.stringify(workFields(scope).filter(e=>e.closest('[data-lc-work-form]')===scope).map(e=>[e.name,e.tagName,e.type,e.type==='checkbox'||e.type==='radio'?[e.checked,e.value]:e.tagName==='SELECT'&&e.multiple?Array.from(e.selectedOptions,o=>o.value):e.dataset.personId??e.value]));
}
export function protectWorkForm(scope,{dynamic=false}={}){
 if(scope.lcIsDirty)return scope;
 scope.dataset.lcWorkForm='1';
 let baseline=signature(scope),touched=!dynamic;
 if(dynamic){
  // Defaults/derived values may load asynchronously before the first edit.
  const before=()=>{if(!touched)baseline=signature(scope)};
  for(const event of ['pointerdown','focusin','keydown'])scope.addEventListener(event,before,true);
  for(const event of ['input','change','lc-person-change'])scope.addEventListener(event,()=>{touched=true},true);
  // Adding/removing an editable row is also an edit, even with empty values.
  scope.addEventListener('click',e=>{if(e.target.closest('button'))queueMicrotask(()=>{if(scope.isConnected&&!touched&&signature(scope)!==baseline)touched=true})},true);
 }
 scope.lcIsDirty=()=>touched&&signature(scope)!==baseline;
 scope.lcResetForm=()=>{baseline=signature(scope);touched=!dynamic};
 return scope
}
export function hasUnsavedForms(root){
 return Array.from(root.querySelectorAll('[data-lc-work-form]')).some(e=>e.lcIsDirty?.()===true)
}

 // Register by actual write controls, rather than a list of route names.
 const writeSelector='button[data-lc-write]';
 const containers='[data-lc-write-scope],details,section.panel';
 export function registerWriteForms(content){
  if(content.lcWriteObserver)return;
  const scan=()=>{
   const scopes=new Set();
   for(const b of content.querySelectorAll(writeSelector)){
    if(b.closest('[data-lc-work-form]'))continue;
    const scope=b.closest(containers);
    if(scope&&content.contains(scope))scopes.add(scope);
   }
   // Children first; parent snapshots exclude separately registered editors.
   const ordered=[...scopes].sort((a,b)=>a.contains(b)?1:b.contains(a)?-1:0);
   for(const scope of ordered)if(!scope.closest('[data-lc-work-form]')&&workFields(scope).some(e=>!e.closest('[data-lc-work-form]')))protectWorkForm(scope,{dynamic:true});
  };
  scan();
  const observer=new MutationObserver(records=>{
   if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches(writeSelector)||n.querySelector(writeSelector)))))scan()
  });
  observer.observe(content,{childList:true,subtree:true});content.lcWriteObserver=observer;
  // A successful write redraws the card; protect other unsaved editors too.
  content.addEventListener('click',e=>{
   const b=e.target.closest(writeSelector);if(!b||b.disabled)return;
   const owner=b.closest('[data-lc-work-form]');
   const other=Array.from(content.querySelectorAll('[data-lc-work-form]')).some(s=>s!==owner&&s.lcIsDirty?.());
   if(other&&!window.confirm('В другой форме есть несохранённые изменения. Продолжить и отбросить их?')){e.preventDefault();e.stopImmediatePropagation()}
  },true)
 }
