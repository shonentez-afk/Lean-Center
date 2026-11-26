// Shared protection for explicitly registered work forms, never list filters.
// A DOM-local baseline is discarded when a new screen is built after saving.
const fieldSelector='input[name]:not([type=file]),select[name],textarea[name],button.lc-directory-trigger[name]';
export const workFields=scope=>Array.from(scope.querySelectorAll(fieldSelector));
function signature(scope){
 return JSON.stringify(workFields(scope).map(e=>[e.name,e.tagName,e.type,e.type==='checkbox'||e.type==='radio'?[e.checked,e.value]:e.tagName==='SELECT'&&e.multiple?Array.from(e.selectedOptions,o=>o.value):e.dataset.personId??e.value]));
}
export function protectWorkForm(scope,{dynamic=false}={}){
 if(scope.lcIsDirty)return scope;
 let baseline=signature(scope),touched=!dynamic;
 scope.dataset.lcWorkForm='1';
 if(dynamic){
  // Defaults/derived values may load asynchronously before the first edit.
  const before=()=>{if(!touched)baseline=signature(scope)};
  for(const event of ['pointerdown','focusin','keydown'])scope.addEventListener(event,before,true);
  for(const event of ['input','change','lc-person-change'])scope.addEventListener(event,()=>{touched=true},true);
  // Adding/removing an editable row is also an edit, even with empty values.
  scope.addEventListener('click',e=>{if(e.target.closest('button'))queueMicrotask(()=>{if(scope.isConnected&&!touched&&signature(scope)!==baseline)touched=true})},true);
 }
 scope.lcIsDirty=()=>touched&&signature(scope)!==baseline;
 return scope
}
export function hasUnsavedForms(root){
 return Array.from(root.querySelectorAll('[data-lc-work-form]')).some(e=>e.lcIsDirty?.()===true)
}
