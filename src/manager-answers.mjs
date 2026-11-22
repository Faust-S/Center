// Source-grounded deterministic management explanations. No model, signer,
// permission engine, search index, graph or authority is created here.
export const MANAGER_QUESTIONS=Object.freeze([
 {id:'attention',label:'Что требует моего внимания?'},
 {id:'review',label:'Какие Result ждут решения?'},
 {id:'signed',label:'Какие поручения подписаны?'},
 {id:'atlas',label:'Что известно о проектах?'}
]);
const SOURCE_REQUIRED='SOURCE_REQUIRED';
const rows=(source)=>Array.isArray(source)?source:[];
const linked=(item)=>({key:item.kind+':'+item.id,kind:item.kind,id:item.id,
 title:item.title,detail:item.summary,source:item.source});
/**
 * @param {string} question
 * @param {{organization?:any,owner?:any,atlasView?:any,rows?:any[],alerts?:any[]}} [sources]
 * @returns {{question:string,title:string,status:string,summary:string,
 *  items:Array<{key:string,kind:string,id:string,title:string,detail:string,source:string}>,scope:string}}
 */
export function answerManagerQuestion(question,{organization=null,owner=null,atlasView=null,
  rows:availableRows=[],alerts=[]}={}){
 const orgId=organization?.id;
 const signed=typeof orgId==='string'&&owner?.status==='SIGNED_D3_READBACK'&&
   owner.organizationId===orgId;
 const completeInbox=signed&&owner.inboxLoaded===true;
 const messages={
  attention:'Требует внимания',
  review:'Результаты для решения',
  signed:'Подписанные поручения',
  atlas:'Проекты и работы'
 };
 if(!Object.hasOwn(messages,question))throw Error('CEN_MANAGER_QUESTION_UNKNOWN');
 const make=(status,summary,items,scope)=>({question,title:messages[question],
   status,summary,items:items.slice(0,12),scope});
 if(question==='attention'){
   const items=rows(alerts).map(a=>({
     key:a.key,kind:'attention',id:a.key,title:a.title,detail:a.detail,
     source:a.key?.startsWith('signed-inbox:')?'Оригинальный T3 Reconciliation':'Локальный черновик'
   }));
   return make('SOURCE_SUMMARY',
     items.length?'По доступным источникам выявлены вопросы, требующие проверки: '+items.length+'.'
       :'По доступным источникам вопросов внимания не выявлено. Это не доказывает отсутствия проблем.',
     items,completeInbox?'Черновики и прочитанный оригинальный Reconciliation':
       'Только доступная часть источников; оригинальный Reconciliation не подтверждён');
 }
 if(question==='review'){
   if(!completeInbox)return make(SOURCE_REQUIRED,
     'Для ответа нужно вручную прочитать подписанный корпоративный T3 и исходный Reconciliation.',[],
     'Неизвестно: отсутствие данных не означает отсутствие пакетов.');
   const list=rows(owner.attention).filter(a=>a.key?.startsWith('signed-inbox:')).map(a=>({
     key:a.key,kind:'signed-result-package',id:a.key.slice('signed-inbox:'.length),
     title:a.title,detail:a.detail,source:'Оригинальный T3 Reconciliation'
   }));
   return make('SOURCE_SUMMARY',list.length
     ?'Оригинальный Reconciliation требует рассмотрения или сверки по '+list.length+' пакетам.'
     :'В прочитанной части оригинального Reconciliation нет пакетов с нерешённым Review или конфликтом.',
     list,owner.inboxTruncated
       ?'Прочитана часть пакетов; исходный журнал содержит больше записей.'
       :'Прочитан список пакетов исходного Reconciliation. ACCEPT не означает Kernel Apply.');
 }
 if(question==='signed'){
   if(!signed)return make(SOURCE_REQUIRED,
     'Список подписанных поручений текущей организации ещё не прочитан.',[],
     'Черновики не являются подписанными Task.');
   const list=rows(owner.entries).filter(r=>r.kind==='signed-task').map(linked);
   return make('SOURCE_SUMMARY',
     'Оригинальный T3 зарегистрировал '+owner.totalTasks+' подписанных Task. Их доставка сотрудникам не подтверждается этим обзором.',
     list,list.length<owner.totalTasks
       ?'Показана часть исходного списка Task.'
       :'Подписанный список Task текущей Workspace; не доказательство исполнения.');
 }
 if(!atlasView||!Array.isArray(atlasView.projects))
   return make(SOURCE_REQUIRED,'Источник Atlas не открыт для выбранной организации.',[],
     'Atlas необязателен для обычных корпоративных поручений.');
 const list=rows(availableRows).filter(r=>r.kind==='atlas-project').map(linked);
 return make('SOURCE_SUMMARY',
   'В явно открытом наблюдении Atlas обнаружено проектов: '+atlasView.projects.length+'.',
   list,'Наблюдение Atlas не подтверждает права T3, выполнение задач или свежую синхронизацию.');
}
