import React,{useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';

type ExchangeFile={path:string;size:number;sha256:string};
type ExportPreview={format:string;format_version:string;task_id:string;result_id:string;
 source_workspace_id:string;file_count:number;source_bytes:number;task_sha256:string;state_sha256:string;
 result_sha256:string;files:ExchangeFile[];file_set_sha256:string;
 includes_global_memory:boolean;includes_task_context:boolean;
 profile:string;profile_version:string};
type PackageInspection={format:string;format_version:string;profile:string;
 profile_version:string|null;source_task_id:string|null;source_result_id:string|null;
 source_workspace_id?:string;bytes:number;file_sha256:string;file_count:number;
 supported_for_import:boolean;unsupported_reason?:string;included_global_memory?:boolean;
 files?:ExchangeFile[];task_file_count?:number;task_source_bytes?:number;
 included_task_context?:boolean};
type Receipt={state:string;path?:string;bytes?:number;file_sha256:string;
 task_id?:string;result_id?:string;workspace_id?:string;package_digest:string;
 verified_readback?:boolean};
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const exchangeErrors:Record<string,[string,string]>={
 IWXA_TASK_NOT_ACCEPTED:['Этот результат ещё не принят. Сначала сохраните решение по задаче.','This Result has not been accepted yet. Save the Task review first.'],
 IWXA_TASK_OUTSIDE_WORKSPACE:['Задача отсутствует в выбранной рабочей области.','The Task is not in the selected Workspace.'],
 IWXA_SOURCE_REVISION_CHANGED:['Задача или результат изменились. Обновите состав переноса.','The Task or Result changed. Preview the transfer again.'],
 IWXA_SOURCE_FILE_SET_CHANGED:['Состав или содержимое файлов изменились. Проверьте список повторно.','The file set or contents changed. Preview the files again.'],
 IWXA_EXPORT_PATH_INVALID_OR_EXISTS:['Выберите другой путь: файл уже существует или папка недоступна.','Choose another location: the file exists or the folder is unavailable.'],
 IWXA_EXPORT_ABSOLUTE_PATH_REQUIRED:['Укажите полный путь сохранения файла .iwxa.','Enter the complete destination path for the .iwxa file.'],
 IWXA_FILE_NOT_REGULAR_OR_SIZE_INVALID:['Файл недоступен или превышает поддерживаемый размер.','The file is unavailable or exceeds the supported size.'],
 IWXA_IMPORT_FILE_CHANGED_SINCE_PREVIEW:['Файл изменился после проверки. Проверьте пакет снова.','The file changed after inspection. Inspect the package again.'],
 IWXA_IMPORT_FILE_CHANGED_DURING_READ:['Файл изменился во время импорта. Повторно проверьте исходный файл.','The file changed during import. Inspect the source file again.'],
 IWXA_TASK_IDENTITY_CONFLICT:['Задача с этим ID уже существует, но её содержимое отличается. Перезапись запрещена.','A Task with this ID already exists with different contents. Overwriting is not allowed.'],
 IWXA_PROFILE_UNSUPPORTED:['Этот профиль пока не поддерживается для личного импорта.','This profile is not supported for personal import yet.'],
 IWXA_PERSONAL_PROFILE_VERSION_UNSUPPORTED:['Версия личного профиля не поддерживается.','This personal profile version is unsupported.'],
 IWXA_PERSONAL_MANIFEST_SCOPE_MISMATCH:['Манифест пакета не соответствует переносимым данным.','The package manifest does not match its contents.'],
 IWXA_WORKSPACE_READBACK_FAILED:['Не удалось проверить результат импорта в рабочей области.','The imported Task could not be verified in this Workspace.'],
 IWXA_LOCAL_AUDIT_PRINCIPAL_REQUIRED:['Локальный профиль владельца недоступен для регистрации импорта.','The local owner profile is unavailable for import registration.'],
 ACTION_OUTCOME_UNCONFIRMED:['Состояние операции неизвестно. Проверьте сохранённые задачи перед повтором.','The operation outcome is unknown. Check saved Tasks before retrying.'],
 STALE_ETAG_OR_REVISION:['Состояние задачи изменилось. Обновите данные и повторите действие.','Task state changed. Refresh and retry.'],
};
function friendlyError(e:unknown,tr:(ru:string,en:string)=>string):string{
 const technical=(e&&typeof e==='object'&&'code' in e?String(e.code):'').toUpperCase();
 const detail=errorText(e).toUpperCase();
 const match=Object.entries(exchangeErrors).find(([code])=>technical===code||detail.includes(code));
 return match?tr(match[1][0],match[1][1]):tr('Не удалось завершить перенос. Проверьте файл и соединение с Core.',
  'Could not complete the transfer. Check the file and Core connection.');
}

/** Explicit local file exchange, never a signed org transfer or a remote permission. */
export function IwxaExchangeControl({taskId,workspaceId,onImported}:{
 taskId:string|null;workspaceId:string;onImported?:(taskId:string)=>void;
}){
 const {tr}=useUiSettings();
 const [exportPath,setExportPath]=useState('');
 const [importPath,setImportPath]=useState('');
 const [preview,setPreview]=useState<ExportPreview|null>(null);
 const [inspection,setInspection]=useState<PackageInspection|null>(null);
 const [receipt,setReceipt]=useState<Receipt|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [acknowledged,setAcknowledged]=useState(false);
 const [filesShown,setFilesShown]=useState(20);
 const [importFilesShown,setImportFilesShown]=useState(20);
 const sequence=useRef(0);
 const activeTask=taskId||'';
 function reset(){sequence.current++;setPreview(null);setInspection(null);setReceipt(null);setError('');
  setAcknowledged(false);setFilesShown(20);setImportFilesShown(20);}
 async function prepareExport(){
  if(!activeTask||busy)return;
  const n=++sequence.current;setBusy(true);setError('');setPreview(null);setReceipt(null);
  setAcknowledged(false);setFilesShown(20);
  try {
   const p=await runtime.query<ExportPreview>('iwxa_exchange_preview',{task_id:activeTask,workspace_id:workspaceId});
   if(p.format!=='iwxa.package'||p.format_version!=='1.0'||p.task_id!==activeTask||
      p.source_workspace_id!==workspaceId||p.includes_global_memory!==false||
      !/^[0-9a-f]{64}$/.test(p.task_sha256)||!/^[0-9a-f]{64}$/.test(p.state_sha256)||
      !/^[0-9a-f]{64}$/.test(p.result_sha256)||!/^[0-9a-f]{64}$/.test(p.file_set_sha256)||
      !Array.isArray(p.files)||p.files.length!==p.file_count||p.files.some(f=>
        typeof f.path!=='string'||!Number.isSafeInteger(f.size)||f.size<0||
        !/^[0-9a-f]{64}$/.test(f.sha256)))
    throw Error('iwxa_export_preview_unverified');
   if(n===sequence.current)setPreview(p);
  }catch(e){if(n===sequence.current)setError(friendlyError(e,tr))}
  finally{if(n===sequence.current)setBusy(false)}
 }
 async function exportFile(){
  if(!preview||busy||!acknowledged||!exportPath.toLowerCase().endsWith('.iwxa')||
     preview.task_id!==activeTask||preview.source_workspace_id!==workspaceId)return;
  const n=++sequence.current;setBusy(true);setError('');setReceipt(null);
  try {
   // The owner Core revalidates the Task, review, and every source file.
   const r=await runtime.command<Receipt>('iwxa_exchange_export',
    {task_id:activeTask,workspace_id:workspaceId,path:exportPath,
     expected_task_sha256:preview.task_sha256,expected_state_sha256:preview.state_sha256,
     expected_result_sha256:preview.result_sha256,
     expected_file_set_sha256:preview.file_set_sha256},{kind:'task',id:activeTask});
   if(r.state!=='EXPORTED'||r.path!==exportPath||!/^[0-9a-f]{64}$/.test(r.file_sha256))
    throw Error('iwxa_export_receipt_invalid');
   if(n===sequence.current)setReceipt(r);
  }catch(e){if(n===sequence.current)setError(friendlyError(e,tr))}
  finally{if(n===sequence.current)setBusy(false)}
 }
 async function inspectFile(){
  if(!importPath.toLowerCase().endsWith('.iwxa')||busy)return;
  const n=++sequence.current;setBusy(true);setError('');setInspection(null);setReceipt(null);setImportFilesShown(20);
  try {
   const p=await runtime.query<PackageInspection>('iwxa_exchange_inspect',{path:importPath});
   if(p.format!=='iwxa.package'||!['1.0','1.1'].includes(p.format_version)||!Number.isFinite(p.bytes)||
      !/^[0-9a-f]{64}$/.test(p.file_sha256))throw Error('iwxa_import_preview_unverified');
   if(p.supported_for_import&&(
       p.profile!=='iwxa.personal-agent.task-result'||!['1.0.0','1.0.1'].includes(p.profile_version||'')||
       !p.source_task_id||!p.source_result_id||!p.source_workspace_id||
       p.included_global_memory!==false||p.included_task_context!==true||
       !Array.isArray(p.files)||p.files.length!==p.task_file_count||
       typeof p.task_source_bytes!=='number'||!Number.isSafeInteger(p.task_source_bytes)||p.task_source_bytes<0||
       p.files.reduce((sum,f)=>sum+f.size,0)!==p.task_source_bytes||
       p.files.some(f=>typeof f.path!=='string'||!Number.isSafeInteger(f.size)||f.size<0||
         !/^[0-9a-f]{64}$/.test(f.sha256))))
     throw Error('iwxa_import_contents_unverified');
   if(n===sequence.current)setInspection(p);
  }catch(e){if(n===sequence.current)setError(friendlyError(e,tr))}
  finally{if(n===sequence.current)setBusy(false)}
 }
 async function importFile(){
  if(!inspection?.supported_for_import||busy)return;
  const n=++sequence.current;setBusy(true);setError('');setReceipt(null);
  try {
   const r=await runtime.command<Receipt>('iwxa_exchange_import',
    {workspace_id:workspaceId,path:importPath,
     expected_file_sha256:inspection.file_sha256},{kind:'workspace',id:workspaceId});
   if(!['IMPORTED','ALREADY_PRESENT'].includes(r.state)||r.workspace_id!==workspaceId||
      r.verified_readback!==true||r.file_sha256!==inspection.file_sha256||!r.task_id)
    throw Error('iwxa_import_receipt_unverified');
   if(n===sequence.current){setReceipt(r);onImported?.(r.task_id);}
  }catch(e){if(n===sequence.current)setError(friendlyError(e,tr))}
  finally{if(n===sequence.current)setBusy(false)}
 }
 return <details className="subpage card" onToggle={event=>{if(!event.currentTarget.open)reset();}}>
  <summary>{tr('Перенос задачи и результата (.iwxa)','Task and Result transfer (.iwxa)')}</summary>
  <p>{tr('Локальный перенос принятой задачи, результата и истории проверки. Общая память не включается. Файл не подписывает организационное поручение.',
   'Locally transfer an accepted Task, Result and verification history. Global memory is excluded. The file does not sign an organizational assignment.')}</p>
  <section className="advanced-form">
   <h3>{tr('Экспорт принятого результата','Export accepted Result')}</h3>
   <button type="button" disabled={!activeTask||busy} onClick={()=>void prepareExport()}>
    {tr('Проверить состав переноса','Preview transfer contents')}</button>
   {preview&&<div role="status">
    <p>{tr('Задача','Task')}: {preview.task_id} · Result: {preview.result_id} · {preview.file_count} {tr('файлов','files')} · {preview.source_bytes} {tr('байт','bytes')}</p>
    <p>{tr('Переносится ПОЛНАЯ история этой Task, включая контекст выполнения и вложенные данные. Общая память Agent исключена.',
     'The FULL Task history is transferred, including execution context and included data. Global Agent memory is excluded.')}</p>
    <details><summary>{tr('Точный список файлов','Exact list of files')} ({preview.files.length})</summary>
     <ul>{preview.files.slice(0,filesShown).map(f=><li key={f.path}>
      {f.path} · {f.size} {tr('байт','bytes')} · SHA-256 {f.sha256}
     </li>)}</ul>
     {filesShown<preview.files.length&&<button type="button" onClick={()=>setFilesShown(n=>n+20)}>
      {tr('Показать следующие 20','Show next 20')}</button>}
    </details>
    <label><input type="checkbox" checked={acknowledged}
      onChange={e=>setAcknowledged(e.target.checked)}/>
     {tr('Я проверил состав и подтверждаю перенос полной Task и Result.',
        'I reviewed the contents and confirm transfer of the full Task and Result.')}</label>
    <p>{tr('Личный профиль находится на нормативном рассмотрении; это не организационная подпись.',
       'The personal profile awaits normative adoption; this is not an organizational signature.')}</p>
    <label>{tr('Абсолютный путь сохранения .iwxa','Absolute .iwxa output path')}
     <input type="text" value={exportPath} placeholder="C:\\Users\\Public\\Documents\\result.iwxa"
       onChange={e=>{setExportPath(e.target.value);setReceipt(null)}}/></label>
    <button type="button" disabled={busy||!acknowledged||!exportPath.toLowerCase().endsWith('.iwxa')}
      onClick={()=>void exportFile()}>{tr('Создать файл .iwxa','Create .iwxa file')}</button>
   </div>}
  </section>
  <section className="advanced-form">
   <h3>{tr('Импорт в выбранный Workspace','Import into selected Workspace')}</h3>
   <p>{tr('Рабочая область','Destination Workspace')}: {workspaceId}</p>
   <label>{tr('Абсолютный путь существующего файла .iwxa','Absolute path to existing .iwxa')}
    <input type="text" value={importPath} onChange={e=>{setImportPath(e.target.value);setInspection(null);setReceipt(null);setImportFilesShown(20)}}/>
   </label>
   <button type="button" disabled={busy||!importPath.toLowerCase().endsWith('.iwxa')}
    onClick={()=>void inspectFile()}>{tr('Проверить пакет','Inspect package')}</button>
   {inspection&&<div role="status">
    <p>{inspection.profile} {inspection.profile_version||''} · {inspection.bytes} {tr('байт','bytes')} · {inspection.file_count} {tr('файлов','files')}</p>
    <p>{inspection.supported_for_import?
      tr('Совместимый личный пакет. Исходные идентификаторы сохраняются; повторный импорт не создаёт дубликаты.',
         'Compatible personal package. Original identities are preserved; repeated import does not duplicate them.'):
      tr('Профиль или версия пока не поддерживается. Импорт недоступен.',
         'This profile or version is unsupported; import is unavailable.')}</p>
    {inspection.supported_for_import&&<>
     <p>{tr('Исходная задача','Source Task')}: {inspection.source_task_id} ·
        Result: {inspection.source_result_id}</p>
     <p>{tr('Исходный Workspace','Source Workspace')}: {inspection.source_workspace_id}</p>
     <p>{tr('Данные Task','Task-local data')}: {inspection.task_file_count} {tr('файлов','files')} ·
        {inspection.task_source_bytes} {tr('байт','bytes')}</p>
     <details><summary>{tr('Просмотреть файлы перед импортом','Review files before importing')}</summary>
      <ul>{inspection.files?.slice(0,importFilesShown).map(f=><li key={f.path}>
       {f.path} · {f.size} {tr('байт','bytes')} · SHA-256 {f.sha256}
      </li>)}</ul>
      {(inspection.files?.length||0)>importFilesShown&&<button type="button"
        onClick={()=>setImportFilesShown(n=>n+20)}>
        {tr('Показать следующие 20','Show next 20')}</button>}
     </details>
     <p>{tr('Будет восстановлена вся история Task и Result. Общая память не переносится; источник не становится подписанным корпоративным поручением.',
       'The full Task and Result history will be restored. Global memory is excluded; the source does not become a signed organizational assignment.')}</p>
     <button type="button" disabled={busy} onClick={()=>void importFile()}>
      {tr('Импортировать и восстановить','Import and restore')}</button>
    </>}
   </div>}
  </section>
  {receipt&&<p role="status">
    {receipt.state==='ALREADY_PRESENT'?tr('Задача уже присутствует; дубликат не создан.','Task already present; no duplicate created.'):
      receipt.state==='IMPORTED'?tr('Задача и результат восстановлены.','Task and Result restored.'):
      tr('Файл .iwxa сохранён.','The .iwxa file was saved.')}
    {' · '}{receipt.task_id||receipt.path} · SHA-256 {receipt.file_sha256}
    {receipt.verified_readback===true?' · '+tr('Проверено в Core','Verified in Core'):''}
  </p>}
  {error&&<p role="alert">{error}</p>}
 </details>;
}
