import {useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {OwnerError,OwnerMessage,OwnerDetails,record,records,str,failure,useOwnerActions,type Row} from './owner-ui';

const OLLAMA='OLLAMA_LOCAL_V1';
const bytes=(size:unknown)=>{
 const n=Number(size);
 return Number.isFinite(n)&&n>0?(n/1024/1024/1024).toFixed(2)+' GB':'';
};

// Compare only model identifiers returned by the active Ollama source.
// Ollama's omitted tag and :latest are the same selection; distinct
// quantizations/tags must not be treated as interchangeable models.
export function alreadyInstalledOllamaModel(models:Row[],name:string):boolean{
 const canonical=(value:string)=>value.trim().toLowerCase().replace(/:latest$/,'');
 const target=canonical(name);
 return !!target&&models.some(row=>canonical(str(row.name))===target);
}

/** One human-facing catalogue; operations belong only to the existing Ollama owner. */
export function ModelLibrary({ai,onChanged}:{ai:Row;onChanged:()=>Promise<void>}){
 const {tr}=useUiSettings();
 const [term,setTerm]=useState(''),[publisher,setPublisher]=useState('all');
 const [list,setList]=useState<Row[]>([]),[detail,setDetail]=useState<Row|null>(null);
 const [variant,setVariant]=useState(''),[searching,setSearching]=useState(false),[detailBusy,setDetailBusy]=useState(false);
 const [localFile,setLocalFile]=useState(''),[importName,setImportName]=useState(''),[pickerBusy,setPickerBusy]=useState(false);
 const [issue,setIssue]=useState('');
 const searchEpoch=useRef(0),detailEpoch=useRef(0),pullInFlight=useRef(false);
 const {run,busy,message}=useOwnerActions(onChanged);
 const ready=ai.source_confirmed===true&&ai.daemon_ready===true;
 const operation=record(ai.model_operation);
 const selected=records(ai.local_models);
 const unresolved=['RECHECK_REQUIRED','INTERRUPTED_RECHECK_REQUIRED','SOURCE_CHANGED_RECHECK_REQUIRED'].includes(str(operation.state));
 const active=str(ai.selected_model);
 const transferRunning=operation.state==='RUNNING';
 // A query edit immediately invalidates previously displayed results and
 // outstanding catalogue/detail responses, without altering local models.
 function invalidateSearch(){
  searchEpoch.current++;
  detailEpoch.current++;
  setSearching(false);setDetailBusy(false);
  setList([]);setDetail(null);setVariant('');setIssue('');
 }
 async function search(){
  if(searching)return;
  const epoch=++searchEpoch.current;
  ++detailEpoch.current; // invalidate any pending detail for a prior search
  setSearching(true);setDetailBusy(false);setIssue('');setDetail(null);setVariant('');setList([]);
  try{
   const response=record(await runtime.query<Row>('local_model_public_catalog',{search:term,publisher,limit:24}));
   if(epoch!==searchEpoch.current)return;
   setList(records(response.models));
  }catch(e){
   if(epoch===searchEpoch.current)
    setIssue(tr('Каталог сейчас недоступен. Подключение к интернету используется только для этого поиска. ','The public catalogue is unavailable. Internet is used only for this search. ')+failure(e));
  }finally{if(epoch===searchEpoch.current)setSearching(false)}
 }
 async function inspect(item:Row){
  const epoch=++detailEpoch.current;
  setDetailBusy(true);setIssue('');setDetail(null);setVariant('');
  try{
   const result=record(await runtime.query<Row>('local_model_public_detail',{repository:item.id}));
   if(epoch!==detailEpoch.current)return;
   if(result.repository!==item.id)throw Error('model_detail_readback_mismatch');
   setDetail(result);
   const first=records(result.variants)[0];
   if(first)setVariant(str(first.tag));
  }catch(e){if(epoch===detailEpoch.current){setIssue(failure(e));setDetail(null)}}
  finally{if(epoch===detailEpoch.current)setDetailBusy(false)}
 }
 async function change(action:'PULL'|'IMPORT_GGUF'|'DELETE'|'RECHECK',name:string,digest:string|null=null,file:string|null=null){
  if(transferRunning){setIssue(tr('Дождитесь результата текущей операции с моделью.','Wait for the current model operation to finish.'));return}
  if(unresolved&&action!=='RECHECK'){setIssue(tr('Сначала проверьте исход предыдущей операции.','Recheck the previous operation before making changes.'));return}
  if(!ready){setIssue(tr('Сначала подключите Ollama на этом компьютере.','Connect Ollama on this computer first.'));return}
  if(action==='PULL'&&pullInFlight.current)return;
  if(action==='PULL')pullInFlight.current=true;
  try{
  // Never initiate a duplicate large model transfer. Refresh the existing
  // Core inventory before the owner command, because another application may
  // have downloaded the same model since the catalogue was displayed.
  if(action==='PULL'){
   if(alreadyInstalledOllamaModel(selected,name)){
    setIssue(tr('Эта модель уже установлена в Ollama. Выберите её в списке моделей.',
     'This model is already installed in Ollama. Select it from the available models.'));return;
   }
   try{
    const fresh=record(await runtime.query<Row>('local_ai_setup'));
    if(fresh.source_confirmed!==true||fresh.daemon_ready!==true)
     throw Error('ollama_model_inventory_unavailable');
    if(alreadyInstalledOllamaModel(records(fresh.local_models),name)){
     setIssue(tr('Модель уже есть на этом компьютере. Повторная загрузка не нужна.',
      'The model is already on this computer. No second download is needed.'));
     void onChanged().catch(()=>{}); // inventory refresh is best-effort
     return;
    }
   }catch(e){
    setIssue(tr('Не удалось проверить актуальный список моделей. Загрузка не начата. ',
     'Could not check the current model list. No download was started. ')+failure(e));return;
   }
  }
  const reason=action==='RECHECK'?tr('Проверить результат прежней операции по каталогу Ollama, не повторяя её?','Recheck previous operation against Ollama inventory without repeating it?')
   :action==='DELETE'
   ?tr('Удалить модель «','Delete model "')+name+tr('» из хранилища Ollama? Это может затронуть другие приложения, использующие эту модель.','" from Ollama? Other applications may use it.')
   :action==='IMPORT_GGUF'
   ?tr('Импортировать выбранный GGUF в Ollama под именем «','Import the selected GGUF into Ollama as "')+name+tr('»? Исходный файл останется на месте.','"? The original file remains untouched.')
   :tr('Загрузить локальные веса «','Download local model weights "')+name+tr('» через Ollama? Для загрузки нужен интернет.','" through Ollama? An internet connection is required.');
  const result=await run<Row>(reason,'local_model_manage',
   {provider_id:OLLAMA,action,name,expected_digest:digest,file_path:file,confirmed:true},
   {kind:'provider',id:OLLAMA});
  if(result&&record(result).state==='RUNNING')setIssue(tr('Операция началась. Её результат будет проверен по списку моделей.','Operation started. The model inventory will verify the result.'));
  }finally{if(action==='PULL')pullInFlight.current=false;}
 }
 async function pick(){
  if(pickerBusy)return;
  setPickerBusy(true);setIssue('');
  try{
   const result=record(await runtime.command<Row>('local_model_choose_file',{provider_id:OLLAMA},{kind:'provider',id:OLLAMA}));
   if(result.selected===true&&str(result.path)){
    setLocalFile(str(result.path));
    const basename=str(result.name).replace(/\.gguf$/i,'').toLowerCase().replace(/[^a-z0-9_.-]+/g,'-').slice(0,65);
    if(basename)setImportName(basename);
   }
  }catch(e){setIssue(failure(e))}
  finally{setPickerBusy(false)}
 }
 const variants=records(record(detail).variants);
 const chosen=variants.find(row=>str(row.tag)===variant);
 const downloadName=detail&&chosen?'hf.co/'+str(detail.repository)+':'+variant:'';
 const installedVariant=alreadyInstalledOllamaModel(selected,downloadName);
 const canDownload=!!downloadName&&!record(detail).gated&&ready&&!installedVariant;
 return <div className="advanced-form">
  <h3>{tr('Добавить или удалить локальную модель','Add or remove a local model')}</h3>
  <p>{tr('Программы подключаются в «Программах». Поиск охватывает открытые модели разных разработчиков. Операции с Ollama выполняются отдельно, если она подключена.','Programs are connected in Programs. Search covers models from multiple publishers. Ollama operations are separate and require a connected Ollama runtime.')}</p>
  <p>{tr('Поиск обращается к публичному каталогу Hugging Face только по вашей команде. Обновление списка не устанавливает модели.','Public Hugging Face search runs only when requested. Refreshing results never installs weights.')}</p>
  <div className="advanced-actions">
   <label className="advanced-field">{tr('Производитель','Publisher')}
    <select value={publisher} onChange={e=>{invalidateSearch();setPublisher(e.target.value)}}>
     <option value="all">{tr('Все модели','All publishers')}</option>
     <option value="yandex">{tr('Яндекс','Yandex')}</option>
     <option value="sber">{tr('Сбер (AI Sage)','Sber (AI Sage)')}</option>
     <option value="qwen">{tr('Qwen (Китай)','Qwen (China)')}</option>
     <option value="deepseek">{tr('DeepSeek (Китай)','DeepSeek (China)')}</option>
    </select>
   </label>
   <label className="advanced-field">{tr('Название модели','Model name')}<input value={term} onChange={e=>{invalidateSearch();setTerm(e.target.value)}}
    onKeyDown={e=>{if(e.key==='Enter')void search()}} placeholder={tr('Например, GigaChat или YandexGPT','For example, GigaChat or YandexGPT')}/></label>
   <button type="button" disabled={searching} onClick={()=>void search()}>{searching?tr('Ищем…','Searching…'):tr('Найти новые модели','Find models')}</button>
  </div>
  {list.length>0&&<div className="owner-rows">{list.map(item=><div className="owner-row" key={str(item.id)}>
    <strong>{str(item.id)}</strong><span>{str(item.format)==='GGUF'?'GGUF':tr('Совместимость неизвестна','Compatibility unknown')}</span>
    <small>{tr('Лицензия: ','License: ')}{str(item.license)} · {str(item.updated_at)}</small>
    <button type="button" disabled={detailBusy} onClick={()=>void inspect(item)}>{tr('Варианты и условия','Variants and terms')}</button>
   </div>)}</div>}
  {detail&&<div className="owner-row">
   <strong>{str(detail.repository)}</strong>
   <small>{tr('Лицензия: ','License: ')}{str(detail.license)}. {record(detail).gated?tr('Ограниченный доступ: сначала ознакомьтесь с правилами публикации.','Gated model: review publisher access requirements.'):''}</small>
   <a href={str(detail.url)} target="_blank" rel="noreferrer">{tr('Открыть карточку модели и лицензию','Open model card and license')}</a>
   {variants.length?<><label className="advanced-field">{tr('Версия весов','Weights format')}
    <select value={variant} onChange={e=>setVariant(e.target.value)}>
     {variants.map((row,i)=><option key={str(row.tag)+i} value={str(row.tag)}>{str(row.file)} {bytes(row.size_bytes)}</option>)}
    </select></label>
    {installedVariant&&<p role="status">{tr('Эта модель уже установлена в Ollama. Выберите её выше, повторная загрузка не нужна.',
      'This model is already installed in Ollama. Select it instead of downloading again.')}</p>}
    <button type="button" disabled={busy||transferRunning||!canDownload} onClick={()=>void change('PULL',downloadName)}>
     {installedVariant?tr('Уже установлена','Already installed'):tr('Загрузить в Ollama','Download to Ollama')}</button>
   </>:<p>{tr('Не найден подходящий одиночный GGUF. Откройте карточку модели и проверьте доступные форматы.','No compatible single-file GGUF found. Review the model card for formats.')}</p>}
  </div>}
  <div className="advanced-form"><h3>{tr('Модель с этого компьютера','Model from this computer')}</h3>
   <p>{tr('Выберите файл GGUF. Исходный файл не удаляется. Импорт производится в выбранную локальную Ollama.','Select a GGUF file. The original is not deleted; Ollama imports the selected weights.')}</p>
   <div className="advanced-actions"><button type="button" disabled={pickerBusy||busy||transferRunning} onClick={()=>void pick()}>{tr('Выбрать файл…','Choose a file…')}</button>
    <label className="advanced-field">{tr('Путь к GGUF','GGUF path')}<input value={localFile} onChange={e=>setLocalFile(e.target.value)} placeholder="C:\models\model.gguf"/></label>
    <label className="advanced-field">{tr('Имя в Ollama','Name in Ollama')}<input value={importName} onChange={e=>setImportName(e.target.value)} placeholder="my-model"/></label>
   </div>
   <button type="button" disabled={!ready||busy||transferRunning||!/^[a-z0-9][a-z0-9_.-]{0,79}(?::[a-z0-9_.-]{1,32})?$/.test(importName)||!localFile.toLowerCase().endsWith('.gguf')}
    onClick={()=>void change('IMPORT_GGUF',importName,null,localFile)}>{tr('Импортировать GGUF','Import GGUF')}</button>
   <p>{tr('Для Safetensors необходима отдельная проверка структуры и совместимости. Папка весов не считается готовой моделью автоматически.','Safetensors require architecture and directory validation. A weights folder is not automatically a runnable model.')}</p>
  </div>
  <div className="advanced-form"><h3>{tr('Модели, уже установленные в Ollama','Models already installed in Ollama')}</h3>
   {selected.length===0?<p>{tr('Ollama пока не показывает установленных локальных моделей.','No local models are currently reported by Ollama.')}</p>:
    selected.map(item=><div className="owner-row" key={str(item.name)}>
     <strong>{str(item.name)}</strong><span>{bytes(item.size)}</span>
     <button type="button" disabled={!ready||busy||transferRunning||str(item.name)===active}
      onClick={()=>void change('DELETE',str(item.name),str(item.digest))}>{tr('Удалить модель','Remove model')}</button>
     {str(item.name)===active&&<small>{tr('Сначала выберите другую модель, чтобы удалить текущую.','Choose another model before deleting the active one.')}</small>}
    </div>)}
  </div>
  {unresolved&&<button type="button" disabled={busy||transferRunning||!ready||operation.state==='SOURCE_CHANGED_RECHECK_REQUIRED'} onClick={()=>void change('RECHECK',str(operation.name))}>{tr('Проверить результат без повторения','Recheck result without retry')}</button>}
  <p role="status">{operation.state==='RUNNING'?tr('Операция выполняется. Не закрывайте IWXA до завершения.','Operation in progress. Keep IWXA open until completion.')
    :operation.state==='INTERRUPTED_RECHECK_REQUIRED'||operation.state==='RECHECK_REQUIRED'
    ?tr('Результат операции не подтверждён. Обновите список моделей перед повторной попыткой.','Operation outcome is uncertain. Refresh the model list before retrying.')
    :operation.state==='SUCCEEDED'?tr('Операция подтверждена проверкой каталога Ollama.','Operation confirmed by Ollama inventory readback.'):''}</p>
  {message&&<OwnerMessage>{message}</OwnerMessage>}
  {issue&&<OwnerError error={issue}/>}
  {operation.state==='RUNNING'&&typeof operation.completed_bytes==='number'&&typeof operation.total_bytes==='number'&&operation.total_bytes>0&&<div><progress value={Number(operation.completed_bytes)} max={Number(operation.total_bytes)} style={{width:'100%'}}/><small>{bytes(operation.completed_bytes)} / {bytes(operation.total_bytes)}</small></div>}
  <OwnerDetails title={tr('Сведения об операции','Operation details')} value={operation}/>
 </div>;
}
