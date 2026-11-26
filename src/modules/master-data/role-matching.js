// Shared role matching; retain the directory's existing broad instructor grouping.
const roleKey=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim().replaceAll('-','_');
const INTERNAL_TRAINER=new Set(['internal_trainer','internal trainer','внутренний тренер','вт']);
export function matchesRoleKind(role,kind){
 if(!role)return false;
 if(kind==='internal_trainer')return role.kind==='internal_trainer'||[role.code,role.name].some(value=>INTERNAL_TRAINER.has(roleKey(value)));
 return role.kind===kind;
}
