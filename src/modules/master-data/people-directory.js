// Current directory roles are business assignments, never file/app permissions.
import {rows} from '../../core/primitives.js';
export const personKey=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim();
const aliases={
 instructor:['instructor','trainer','internal_trainer','internal trainer','twi_instructor','инструктор','инструктор twi','внутренний тренер','вт'],
 mentor:['mentor','наставник','twi_mentor'],
 trainee:['trainee','learner','обучаемый','стажер','twi_trainee'],
 evaluator:['evaluator','assessor','оценщик','аудитор']
};
export function roleKind(code,name){for(const value of [name,code]){const key=personKey(value).replaceAll('-','_');for(const [kind,values] of Object.entries(aliases))if(values.includes(key))return kind}return null}
export function directoryPeople(db,day){
 const all=rows(db,`SELECT p.id,p.employee_code,p.display_name,COALESCE(pos.name,prof.name,'') position,COALESCE(u.name,'') unit FROM person p
 LEFT JOIN person_assignment a ON a.id=(SELECT a2.id FROM person_assignment a2 WHERE a2.person_id=p.id AND a2.valid_from<=? AND (a2.valid_to IS NULL OR a2.valid_to>=?) ORDER BY a2.valid_from DESC,a2.id LIMIT 1)
 LEFT JOIN position pos ON pos.id=a.position_id LEFT JOIN profession prof ON prof.id=a.profession_id LEFT JOIN org_unit u ON u.id=a.unit_id
 WHERE p.archived=0 ORDER BY p.display_name,p.employee_code`,[day,day]);
 const assigned=rows(db,`SELECT a.person_id,b.code,b.name FROM role_assignment a JOIN business_role b ON b.id=a.role_id WHERE b.archived=0 AND a.valid_from<=? AND (a.valid_to IS NULL OR a.valid_to>=?) ORDER BY b.name`,[day,day]);
 const index=new Map();for(const x of assigned){if(!index.has(x.person_id))index.set(x.person_id,[]);index.get(x.person_id).push({code:x.code,name:x.name,kind:roleKind(x.code,x.name)})}
 return all.map(p=>({...p,roles:index.get(p.id)||[]}))
}
