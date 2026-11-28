// Editable initial access profiles. Installing the catalogue never creates
// users, assignments, grants, certificates or production facts.
import {PERMISSIONS} from './access-contract.mjs';
import {rows} from '../../src/core/db.js';
const unique=(...parts)=>Object.freeze([...new Set(parts.flat())].sort());
const own=['person.read_basic','person.read_card','training.read','training.detail','training.read_sop','training.enrollment.read','training.enrollment.detail','preparation.read','preparation.detail','assessment.read','assessment.detail','development.read','development.detail','task.read','task.detail','task.start','task.implement_own','calendar.read','calendar.detail','plan.read','assistant.read'];
const teach=unique(own,['training.stage','credential.read','appointment.read','authorization.read','audit.read','audit.detail','self.read','self.detail','self.create','assistant.cloud']);
const org=['org.read','person.read_basic','person.read_directory','person.read_card','operation.read','workplace.read','equipment.read','employment.read','employment.detail','role_assignment.read','profession.read','position.read','shift.read','role.read','category.read','scale.read'];
const documents=['sop.read_effective','sop.read_history','sop.read_steps','sop.read_photo','sop.read_twi','sop.read_linked_frv','frv.read','frv.read_summary'];
const plans=['matrix.read','matrix.detail','skill.read','requirement.read','coverage.read','program.read','program.detail','bank.read','bank.detail','credential.read','appointment.read','authorization.read','order.read','order.detail','audit.read','audit.detail','self.read','self.detail'];
const reports=['center.read','analytics.read','metrics.read','assistant.read','assistant.cloud'];
const planner=['training.create','training.reschedule','training.cancel','matrix.create','matrix.retire','requirement.create','requirement.close','coverage.save','development.create','development.from_matrix','development.goal.create','development.goal.close','development.close','task.create','task.link','task.verify','task.cancel','calendar.plan','calendar.replan','calendar.cancel','calendar.complete'];
const prep=['training.enrollment.create','training.enrollment.result','training.enrollment.finish','training.enrollment.cancel','preparation.create','preparation.shift','preparation.safety','preparation.internship','preparation.questions','preparation.commission'];
const assess=['training.practical','training.verify','training.qualify','assessment.general'];
const profile=(key,name,scope,description,permissions,aliases=[])=>Object.freeze({key,code:'LC81_TWI_'+key.toUpperCase(),name,scope,description,permissions:unique(permissions),aliases});
export const ROLE_PRESETS=Object.freeze([
 profile('employee','Сотрудник','self','Личные записи, план, задачи и результаты обучения.',own,['worker','employee','работник']),
 profile('trainee','Обучаемый','self','Собственное обучение, адаптация, оценочные результаты и задачи.',own,['trainee','learner','twi_trainee','стажер','ученик']),
 profile('instructor','Инструктор','assigned','Назначенные инструктажи и ученики; собственная подготовка и самооценка.',teach,['instructor','twi_instructor','инструктор twi']),
 profile('mentor','Наставник','assigned','Сопровождение закреплённых программ и фиксация результатов; без автоматических решений о допуске.',unique(own,['training.enrollment.result','training.stage','credential.read','appointment.read','authorization.read','self.read','self.detail','self.create','assistant.cloud']),['mentor','twi_mentor']),
 profile('internship_mentor','Наставник стажировки','assigned','Работа с назначенной стажировкой и фактами прохождения; без полномочий инструктора TWI.',unique(own,['training.enrollment.result','preparation.shift']),['internship_mentor','наставник программы стажировки']),
 profile('internal_trainer','Внутренний тренер','unit_tree','Методическое сопровождение, планы, матрицы, подготовка инструкторов и контроль качества обучения.',unique(own,org,documents,plans,reports,planner,assess,['training.stage','sop.approval.twi','sop.create','sop.edit_draft','sop.revise','sop.passport','sop.from_frv','frv.create','frv.edit_draft','frv.finalize','operation.create','operation.update','skill.from_sop','credential.register','appointment.register','authorization.register','self.create','audit.create','audit.mobile.export','audit.mobile.import','sop.evaluation.read','sop.evaluation.create','training.approve_responsible','training.enrollment.create','training.enrollment.result','bank.save','forms.read','forms.export']),['internal_trainer','internal trainer','вт','внутренний тренер twi']),
 profile('line_manager','Непосредственный руководитель','unit_tree','Подготовка сотрудников, оценка, планы и контроль в своей области.',unique(own,org,documents,plans,reports,planner,prep,assess,['training.approve_responsible','training.admit','forms.read','forms.export','operation.create','operation.update']),['line_manager','нр']),
 profile('shift_head','Начальник смены','unit_tree','Планирование обучения в разрешённом подразделении. Отдельная область смены пока не поддерживается.',unique(own,org,documents,plans,reports,planner,prep,assess,['training.approve_responsible','forms.read','forms.export']),['shift_head','нс']),
 profile('unit_head','Руководитель подразделения','unit_tree','Руководство обучением и подтверждение планов в своей области.',unique(own,org,documents,plans,reports,planner,prep,assess,['training.approve_head','training.admit','forms.read','forms.export']),['unit_head','руководитель цеха']),
 profile('hr','Сотрудник отдела персонала','unit_tree','Кадровое и организационное сопровождение подготовки без присвоения квалификации.',unique(own,org,['program.read','program.detail','training.enrollment.create','preparation.create','preparation.questions','person.create','person.update','employment.transfer','forms.read','forms.export','center.read','analytics.read']),['hr','отдел персонала','специалист по персоналу']),
 profile('change_agent','Агент перемен','unit_tree','Анализ улучшений и участие в оценочных мероприятиях. Решения комиссии отдельно.',unique(own,['org.read','person.read_basic','operation.read','workplace.read','matrix.read','matrix.detail','skill.read','center.read','analytics.read','metrics.read','sop.evaluation.read','audit.read','audit.detail','task.create','task.link','assistant.cloud']),['change_agent']),
 profile('safety_head','Руководитель ОТ','unit_tree','Доступные материалы по безопасности и решения ОТ по назначенным СОП.',unique(['org.read','operation.read','workplace.read','equipment.read','sop.read_effective','sop.read_steps','sop.read_photo','frv.read','frv.read_summary','center.read','assistant.read','sop.approval.safety']),['safety_head','руководитель сот','руководитель службы охраны труда']),
 profile('chief_engineer','Главный инженер','unit_tree','Технические документы, ФРВ, сводки и решения по назначенным СОП.',unique(['org.read','operation.read','workplace.read','equipment.read','sop.read_effective','sop.read_steps','sop.read_photo','frv.read','frv.read_summary','center.read','analytics.read','assistant.read','sop.approval.engineering']),['chief_engineer']),
 profile('director','Директор предприятия','unit_tree','Сводные показатели, утверждение назначенных СОП и отдельное право ввода в действие.',unique(['org.read','operation.read','center.read','analytics.read','metrics.read','sop.read_effective','sop.read_steps','assistant.read','sop.approval.director','sop.approval.publish','sop.approval.withdraw']),['director','директор']),
 profile('sop_author','Разработчик СОП','self','Общая библиотека и собственные черновики СОП и ФРВ.',unique(['person.read_basic','person.read_card','task.read','task.detail','task.start','task.implement_own','plan.read','assistant.read']),['sop_author','ответственный за разработку соп']),
 profile('observer','Наблюдатель','unit_tree','Разрешённые сводки без дополнительных прав записи; общий базовый доступ сотрудника сохранён.',unique(['org.read','operation.read','center.read','analytics.read','metrics.read','assistant.read']),['observer'])
]);
for(const p of ROLE_PRESETS)if(p.permissions.some(x=>!PERMISSIONS.includes(x)))throw Error('Unknown preset permission: '+p.key);
const normalize=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim().replaceAll('-','_');
const matches=(p,r)=>[r.name,r.code].some(v=>[p.code,p.name,...p.aliases].some(k=>normalize(k)===normalize(v)));
export function matchesApprovalRole(key,role){const p=ROLE_PRESETS.find(x=>x.key===key);return !!p&&matches(p,role)}
export function rolePresetStatus(db,protectedRoles=[]){
 const roles=rows(db,'SELECT id,code,name,archived FROM business_role'),policies=rows(db,'SELECT role_id,revision,permissions_json FROM lc81_policy');
 return ROLE_PRESETS.map(p=>{
  const found=roles.filter(r=>matches(p,r));
  const r=found.length===1&&!found[0].archived&&!protectedRoles.includes(found[0].id)?found[0]:null;
  const policy=r&&policies.find(x=>x.role_id===r.id);
  const same=policy&&JSON.stringify([...JSON.parse(policy.permissions_json)].sort())===JSON.stringify(p.permissions);
  return {...p,aliases:undefined,role_id:r?.id??null,status:found.length===0?'missing':!r?'conflict':!policy?'unconfigured':same?'ready':'custom',revision:policy?.revision??0,existing:found.map(x=>({id:x.id,name:x.name,code:x.code,archived:!!x.archived}))};
 });
}
export function installMissingRolePresets(db,protectedRoles,create,audit){
 const created=[];
 for(const p of rolePresetStatus(db,protectedRoles)){
  if(p.status!=='missing')continue;
  const id=create({code:p.code,name:p.name});
  db.run('INSERT INTO lc81_policy VALUES(?,1,?)',[id,JSON.stringify(p.permissions)]);
  audit(id);created.push(id);
 }
 return created;
}
