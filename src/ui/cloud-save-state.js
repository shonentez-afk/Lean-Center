// Status is derived from actual workspace state, not a success toast or an HTTP ACK.
export function cloudSaveState({pending=0,conflicts=0,dirty=false,editorOpen=false,preview=false,saving=false,syncing=false,offline=false,exchangeFailed=false,checking=false,saveFailed=false,readonly=false}={}){
 const queue=pending?' · в очереди: '+pending:'';
 if(conflicts)return {kind:'conflict',text:'Конфликт изменений'+queue};
 if(saving)return {kind:'saving',text:'Сохранение…'};
 if(dirty||preview)return {kind:'dirty',text:'Есть несохранённые изменения'+queue};
 if(editorOpen)return {kind:'dirty',text:'Редактор открыт · завершите работу'+queue};
 if(saveFailed)return {kind:'error',text:'Проверьте сообщение об ошибке'+queue};
 if(offline)return {kind:'offline',text:pending?'Нет связи · локальная очередь: '+pending:'Нет связи · очередь пуста'};
 if(syncing&&pending)return {kind:'syncing',text:'Синхронизация…'+queue};
 if(exchangeFailed)return {kind:'error',text:pending?'Сохранено локально'+queue:'Обмен не подтверждён'};
 if(pending)return {kind:'pending',text:'Сохранено локально'+queue};
 if(checking)return {kind:'syncing',text:'Проверка связи…'};
 return {kind:'saved',text:readonly?'Только чтение · база получена':'Все изменения сохранены'};
}
