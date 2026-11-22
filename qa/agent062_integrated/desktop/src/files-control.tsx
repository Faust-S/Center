import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {verifiedPersonalFolder,type PersonalFolderRoot} from './files-root-readback';
import {documentTextAttachment,wholeDocumentTextAttachment,documentHistoryAfterRead} from './document-readback';
import {verifiedPdfOcrOffer} from './pdf-ocr-readback';
import {readWorkAreas} from './work-area-flow';

// Navigation-only pointer, not a document store: re-read the actual file through
// Local Files after returning to Materials. Never retain file contents here.
type RecentDocument={path:string;sha256:string;offsetChars:number;workspaceId:string};
let recentDocument:RecentDocument|null=null;

export function FilesControl({onConfigure,onOpenTask,onAnalyze,onStartOcr}:{onConfigure:()=>void;onOpenTask:()=>void;onAnalyze:(file:{name:string;text:string;sourcePath:string})=>void;onStartOcr:(selection:{path:string;sha256:string;pagesTotal:number})=>void}){
 const {tr}=useUiSettings();
 const [catalog,setCatalog]=useState<Row>({}),[receipts,setReceipts]=useState<Row[]>([]),[error,setError]=useState('');
 const [path,setPath]=useState(''),[readBusy,setReadBusy]=useState(false),[file,setFile]=useState<Row|null>(null);
 const [backOffsets,setBackOffsets]=useState<number[]>([]);
 const [folder,setFolder]=useState(''),[items,setItems]=useState<Row[]>([]);
 const [folderLoaded,setFolderLoaded]=useState(false),[browseBusy,setBrowseBusy]=useState(false);
 const [term,setTerm]=useState(''),[hits,setHits]=useState<Row[]>([]);
 const [searchBusy,setSearchBusy]=useState(false),[searchDone,setSearchDone]=useState(false);
 const [scanned,setScanned]=useState<number|null>(null);
 const readEpoch=useRef(0),browseEpoch=useRef(0),searchEpoch=useRef(0),rootEpoch=useRef(0);
 const [verifiedRoot,setVerifiedRoot]=useState<PersonalFolderRoot|null>(null),[rootError,setRootError]=useState('');
 const currentArea=useRef('');
 const validSegment=(name:string)=>name.length>0&&name!=='.'&&name!=='..'&&!name.startsWith('.')
  &&!/[\\/<>:"|?*\x00-\x1f]/.test(name)&&!/[. ]$/.test(name)
  &&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
 const validRelative=(name:string)=>name.length<=2048&&!!name&&name.split('/').every(validSegment);
 const childPath=(base:string,name:string)=>base?base+'/'+name:name;
 const parentPath=(base:string)=>base.split('/').slice(0,-1).join('/');
 const load=useCallback(async()=>{
  const results=await Promise.allSettled([runtime.query<Row>('tool_catalog'),runtime.query<Row>('tool_read_receipts',{limit:100})]);
  setCatalog(results[0].status==='fulfilled'?record(results[0].value):{});
  setReceipts(results[1].status==='fulfilled'?records(record(results[1].value).receipts):[]);
  setError(results.flatMap((r,i)=>r.status==='rejected'?[(i===0?'tool_catalog':'tool_read_receipts')+': '+failure(r.reason)]:[]).join(' · '));
 },[]);
 useEffect(()=>{void load()},[load]);
 const permitted=(id:string)=>{
  const entry=records(catalog.tools).find(x=>str(record(x.descriptor).tool_id)===id);
  const policy=record(entry?.policy);
  return entry?.available===true&&policy.status==='ALLOW'&&
   policy.effect_class==='READ_ONLY'&&policy.approval_requirement==='NOT_REQUIRED';
 };
 const available=permitted('files.read'),canList=permitted('files.list'),canSearch=permitted('files.search');
 async function readRoot(){
  const seq=++rootEpoch.current;
  try{
   const response=await runtime.command<Row>('tool_read',{arguments:{}},{kind:'tool',id:'files.roots'});
   const verified=verifiedPersonalFolder(response);
   if(seq===rootEpoch.current){setVerifiedRoot(verified);setRootError('');}
  }catch(e){if(seq===rootEpoch.current){setVerifiedRoot(null);setRootError(failure(e));}}
 }
 useEffect(()=>{
  if(!canList){
   ++rootEpoch.current;setVerifiedRoot(null);setRootError('');
   return;
  }
  let mounted=true;
  // Both are receipt-producing ToolRuntime commands. Sequence their
  // owner revisions instead of racing two independent startup effects.
  void (async()=>{
   try{
    const area=await readWorkAreas(runtime);
    if(!mounted)return;
    currentArea.current=str(area.active_id);
    const restore=recentDocument?.workspaceId===currentArea.current?recentDocument:null;
    if(!restore)recentDocument=null;
    await readRoot();
    if(mounted)await browse(restore?parentPath(restore.path):'',true);
    if(mounted&&restore)await readAt(restore.path,restore.sha256,restore.offsetChars,true);
   }catch(e){if(mounted)setError(failure(e))}
  })();
  return()=>{mounted=false;++rootEpoch.current;++readEpoch.current;++browseEpoch.current;++searchEpoch.current;};
 },[canList]);
 const confirmed=(response:Row,tool:string)=>{
  const receipt=record(response.receipt);
  return response.input_required!==true&&receipt.status==='SUCCEEDED'&&
   receipt.tool_id===tool&&receipt.provider_id==='LOCAL_FILES_V1'&&
   /^[a-f0-9]{64}$/i.test(str(receipt.output_digest));
 };
 async function browse(next:string,retainRecent=false){
  if(!retainRecent)recentDocument=null;
  if(!canList||browseBusy||(next!==''&&!validRelative(next)))return;
  const seq=++browseEpoch.current;
  ++searchEpoch.current;++readEpoch.current;
  setReadBusy(false);setBrowseBusy(true);setFolderLoaded(false);setError('');setBackOffsets([]);
  try{
   const response=record(await runtime.command<Row>('tool_read',{
    arguments:{root_id:'personal',path:next,limit:100}},{kind:'tool',id:'files.list'}));
   const data=record(response.data);
   if(!confirmed(response,'files.list')||data.root_id!=='personal'||data.path!==next||
     !Array.isArray(data.items))throw Error('personal_folder_readback_unverified');
   const rows=records(data.items);
   if(rows.length!==data.items.length||rows.length>100||rows.some(x=>
     !validSegment(str(x.name))||!['file','dir'].includes(str(x.kind))||
     (x.sha256!==null&&x.sha256!==undefined&&!/^[a-f0-9]{64}$/i.test(str(x.sha256)))))
    throw Error('personal_folder_entries_invalid');
   if(seq!==browseEpoch.current)return;
   setFolder(next);setItems(rows);setFolderLoaded(true);
   setHits([]);setSearchDone(false);setScanned(null);setFile(null);setPath('');
  }catch(e){if(seq===browseEpoch.current){setItems([]);setError(failure(e));}}
  finally{if(seq===browseEpoch.current)setBrowseBusy(false);}
 }

 async function search(){
  const query=term.trim(),at=folder;
  if(!canSearch||!query||searchBusy||browseBusy||!folderLoaded)return;
  const seq=++searchEpoch.current;
  ++readEpoch.current;setReadBusy(false);setFile(null);recentDocument=null;setBackOffsets([]);
  setSearchBusy(true);setSearchDone(false);setHits([]);setError('');
  try{
   const response=record(await runtime.command<Row>('tool_read',{
    arguments:{root_id:'personal',path:at,query,limit:50}},{kind:'tool',id:'files.search'}));
   const data=record(response.data);
   if(!confirmed(response,'files.search')||data.root_id!=='personal'||
     data.path!==at||data.query!==query||!Array.isArray(data.hits))
    throw Error('personal_file_search_unverified');
   const rows=records(data.hits);
   if(rows.length!==data.hits.length||rows.length>50||rows.some(x=>
     !validRelative(str(x.path))||(at&&!str(x.path).startsWith(at+'/'))||
     !/^[a-f0-9]{64}$/i.test(str(x.sha256))||typeof x.excerpt!=='string'||
     !Number.isSafeInteger(x.match_offset_chars)||Number(x.match_offset_chars)<0||
     Number(x.match_offset_chars)>5000000))
    throw Error('personal_file_search_results_invalid');
   if(seq!==searchEpoch.current)return;
   setHits(rows);setSearchDone(true);
   setScanned(typeof data.scanned_files==='number'?data.scanned_files:null);
  }catch(e){if(seq===searchEpoch.current)setError(failure(e))}
  finally{if(seq===searchEpoch.current)setSearchBusy(false)}
 }
 async function readAt(wanted:string,expectedDigest?:string,offsetChars=0,restoring=false,direction:'jump'|'next'|'back'='jump'){
  if(!available||!validRelative(wanted)||readBusy)return;
  const previous=file?record(file.data):null;
  if(!restoring)recentDocument=null;
  const seq=++readEpoch.current;
  setReadBusy(true);setError('');if(offsetChars===0)setFile(null);
  try{
   const response=record(await runtime.command<Row>('tool_read',{
    arguments:{root_id:'personal',path:wanted,offset_chars:offsetChars,max_text_bytes:32000}},{kind:'tool',id:'files.read'}));
   const data=record(response.data),sha=str(data.sha256);
   if(!confirmed(response,'files.read')||data.root_id!=='personal'||
     data.path!==wanted||typeof data.text!=='string'||!/^[a-f0-9]{64}$/i.test(sha))
    throw Error('verified_personal_file_readback_unavailable');
   if(expectedDigest&&sha.toLowerCase()!==expectedDigest.toLowerCase())
    throw Error('personal_file_changed_since_list_or_search');
   // Core counts Python Unicode code points; JS string.length counts UTF-16 units.
   const textChars=Array.from(data.text).length;
   if(data.offset_chars!==offsetChars||typeof data.total_chars!=='number'||
     typeof data.text_bytes!=='number'||typeof data.format!=='string'||
     new TextEncoder().encode(data.text).length!==data.text_bytes||
     data.text_bytes>32000||data.total_chars<offsetChars+textChars||
     (data.next_offset_chars!==null&&
       (typeof data.next_offset_chars!=='number'||data.next_offset_chars!==offsetChars+textChars||
        data.next_offset_chars>=data.total_chars)))
    throw Error('personal_file_window_invalid');
   if(seq!==readEpoch.current)return;
   if(currentArea.current)recentDocument={path:wanted,sha256:sha,offsetChars,workspaceId:currentArea.current};
   setBackOffsets(history=>documentHistoryAfterRead(previous,data,history,direction));
   setPath(wanted);setFile({receipt:response.receipt,data});
  }catch(e){if(seq===readEpoch.current){
   const reason=failure(e);
   const label=/pdf_no_text_layer_ocr_unavailable/.test(reason)
    ?tr('Текстовый слой PDF не удалось подтвердить. Распознавание доступно только для проверенного скана через отдельную задачу.','The PDF text layer could not be verified. OCR requires an independently checked scan and a separate approved Task.')
    :/pdf_reader_dependency_unavailable/.test(reason)
    ?tr('Для чтения PDF в установленном Agent отсутствует модуль pypdf.','The installed Agent lacks the pypdf reader required for PDF.')
    :/docx_no_text_content/.test(reason)
    ?tr('В DOCX нет извлекаемого текста.','No extractable text was found in the DOCX.')
    :/\b(xlsx_no_text_content|pptx_no_text_content)\b/.test(reason)
    ?tr('В таблице нет заполненных ячеек или в презентации нет извлекаемого текста. Изображения не распознавались.',
      'No populated spreadsheet cells or extractable presentation text. Images were not recognized.')
    :/(utf8_text_required|document_format_not_supported)/.test(reason)
    ?tr('Для чтения доступны TXT, Markdown, CSV, JSON, PDF, DOCX, XLSX и PPTX.',
      'You can read TXT, Markdown, CSV, JSON, PDF, DOCX, XLSX and PPTX.')
    :/file_too_large/.test(reason)
    ?tr('Файл превышает лимит чтения подключённой папки.','The file exceeds the connected folder read limit.')
    :reason;
   setError(label);
  }}
  finally{if(seq===readEpoch.current)setReadBusy(false)}
 }
 async function analyzeWholeDocument(){
  const selected=file?record(file.data):null;
  if(!selected||!available||readBusy)return;
  const wanted=str(selected.path),expectedSha=str(selected.sha256),area=currentArea.current;
  if(!validRelative(wanted)||!area)return;
  const seq=++readEpoch.current;
  setReadBusy(true);setError('');
  try{
   // The preview stays at 32 KB for responsive navigation. Only an explicit
   // request loads up to the Core's existing 48 KB Task attachment limit.
   const response=record(await runtime.command<Row>('tool_read',{
    arguments:{root_id:'personal',path:wanted,offset_chars:0,max_text_bytes:48000}
   },{kind:'tool',id:'files.read'}));
   const data=record(response.data);
   if(seq!==readEpoch.current||area!==currentArea.current)return;
   if(!confirmed(response,'files.read')||data.root_id!=='personal'||
      data.path!==wanted||data.sha256!==expectedSha)
    throw Error('personal_file_changed_since_preview');
   if(data.next_offset_chars!==null||data.partial!==false){
    setError(tr(
     'Полный текст документа не помещается во вложение Task (48 КБ). Можно отправить выбранный фрагмент.',
     'The full document does not fit into a Task attachment (48 KB). You can send the selected excerpt.'));
    return;
   }
   const complete=wholeDocumentTextAttachment(data,selected);
   if(!complete){
    setError(tr(
     'Полный текст вместе с данными об источнике превышает лимит Task или не подтверждён. Используйте фрагмент.',
     'The complete text and its source details exceed the Task limit or could not be verified. Use an excerpt.'));
    return;
   }
   onAnalyze(complete);
  }catch(e){if(seq===readEpoch.current)setError(failure(e))}
  finally{if(seq===readEpoch.current)setReadBusy(false)}
 }
 async function refresh(){
  await load();
  if(canList){
   // Refresh is one user action, but its two read receipts still need
   // ordered revisions. A failed path check never invents a destination.
   await readRoot();
   await browse(folder);
  }
 }
 const attachment=file?documentTextAttachment(record(file.data)):null;
 const ocrOffer=file?verifiedPdfOcrOffer(record(file.data)):null;
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Личные файлы','Personal files')} <HelpTip topic="Файлы"/></h2>
   <p>{tr('Откройте файл из подключённой папки. Чтобы изменить его, сначала подготовьте результат в задаче и подтвердите запись.','Open files from your connected folder. To change a file, prepare the result in a task and approve the write.')}</p></div>
   <button className="secondary-button" disabled={readBusy||browseBusy||searchBusy} onClick={()=>void refresh()}>{tr('Обновить','Refresh')}</button>
  </div>
  {error&&<p className="advanced-error" role="alert">{error}</p>}
  <div className="advanced-form"><h3>{tr('Подключённая папка','Connected folder')}</h3>
   <p>{available?tr('Можно открывать файлы из подключённой папки.','Files in the connected folder can be opened.'):tr('Подключение Personal Files или разрешение READ отсутствует.','Personal Files is not ready or READ is not authorized.')}</p>
   {verifiedRoot?<p role="status">{tr('Проверенная папка на компьютере:','Verified folder on this computer:')} <code>{verifiedRoot.path}</code>
    {verifiedRoot.read_only&&' · '+tr('Только чтение','Read-only')}</p>
    :canList&&<p role="status">{tr('Фактический путь пока не подтверждён. Проверьте подключение перед записью.','The actual folder path has not been verified. Check the connection before writing.')}
      {rootError&&<details><summary>{tr('Причина','Details')}</summary><code>{rootError}</code></details>}</p>}
   <div className="advanced-actions"><button onClick={onConfigure}>{tr('Настроить локальную папку','Configure local folder')}</button><button onClick={onOpenTask}>{tr('Создать или обновить документ из задачи','Create or update a document from a Task')}</button></div>
   {canList&&<div className="advanced-form">
    <h3>{tr('Папки и документы','Folders and documents')}</h3>
    <p>{tr('Текущая папка:','Current folder:')} {folder||tr('Корень Personal Files','Personal Files root')}</p>
    <button type="button" disabled={browseBusy||!folder} onClick={()=>void browse(parentPath(folder))}>
     {tr('На уровень выше','Up one folder')}</button>
    {browseBusy&&<p role="status">{tr('Открываем папку...','Opening folder...')}</p>}
    {folderLoaded&&items.length===0&&<p>{tr('Папка пуста.','This folder is empty.')}</p>}
    {folderLoaded&&items.map(row=>{
     const name=str(row.name),dir=row.kind==='dir',selected=childPath(folder,name);
     return <div className="owner-row" key={selected}>
      <strong>{dir?'📁 ':'📄 '}{name}</strong>
      {row.kind==='file'&&typeof row.bytes==='number'&&<small>{row.bytes} {tr('байт','bytes')}</small>}
      <button type="button" disabled={browseBusy||readBusy||(!dir&&!available)}
       onClick={()=>{if(dir)void browse(selected);else void readAt(selected,str(row.sha256)||undefined)}}>
       {dir?tr('Открыть папку','Open folder'):tr('Прочитать','Read')}</button>
     </div>;
    })}
    {items.length===100&&<p>{tr('Показаны первые 100 элементов. Уточните папку или воспользуйтесь поиском.','Showing up to 100 entries. Choose a narrower folder or search.')}</p>}
   </div>}
   {canSearch&&folderLoaded&&<div className="advanced-form">
    <h3>{tr('Поиск в локальных файлах','Search local files')}</h3>
    <p>{tr('Ищите текст в выбранной папке и её подпапках через подключённый локальный инструмент.','Search text in this folder and its subfolders using the connected local tool.')}</p>
    <label className="advanced-field">{tr('Текст для поиска','Text to find')}
     <input value={term} maxLength={200} onChange={e=>{++searchEpoch.current;setTerm(e.target.value);setHits([]);setSearchDone(false);setSearchBusy(false);}}/>
    </label>
    <button type="button" disabled={browseBusy||searchBusy||!term.trim()} onClick={()=>void search()}>{tr('Найти','Search')}</button>
    {searchBusy&&<p role="status">{tr('Ищем в локальных файлах...','Searching local files...')}</p>}
    {searchDone&&<p role="status">{hits.length?tr('Найдены совпадения:','Matches found:')+' '+hits.length:tr('Совпадений не найдено.','No matches found.')}
     {scanned!==null&&' · '+tr('Проверено файлов:','Files checked:')+' '+scanned}</p>}
    {hits.map(hit=><div className="owner-row" key={str(hit.path)}>
      <strong>{str(hit.path)}</strong>
      <p>{str(hit.excerpt)}</p>
      <button type="button" disabled={!available||readBusy} onClick={()=>
       void readAt(str(hit.path),str(hit.sha256),Math.max(0,Number(hit.match_offset_chars)-160))}>
       {tr('Открыть найденный файл','Open matching file')}</button>
     </div>)}
    {hits.length===50&&<p>{tr('Показаны первые 50 совпадений. Уточните запрос.','Showing up to 50 matches. Refine the search.')}</p>}
   </div>}
   <label className="advanced-field">{tr('Путь относительно Personal Files','Relative path in Personal Files')}
    <input value={path} onChange={e=>{++readEpoch.current;setReadBusy(false);recentDocument=null;setBackOffsets([]);setPath(e.target.value);setFile(null)}} placeholder="notes/report.md" autoComplete="off" />
   </label>
   <button disabled={!available||readBusy||!validRelative(path.trim())} onClick={()=>void readAt(path.trim())}>{tr('Открыть файл','Open file')}</button>
   {file&&<><div className="owner-row"><strong>{str(record(file.data).path)}</strong>
     <small>{str(record(file.data).format).toUpperCase()} · {str(record(file.data).bytes)} {tr('байт исходного файла','source bytes')}</small></div>
    <p role="status">{Number(record(file.data).total_chars)===0
      ?ocrOffer?tr('Это сканированный PDF без текстового слоя. Для работы с содержимым требуется распознавание.',
       'This PDF has no text layer. OCR is required to work with its content.')
       :tr('Документ пуст. Текста для анализа нет.','Document is empty. There is no text to analyze.')
      :<>{tr('Текст документа: символы','Document text: characters')} {Number(record(file.data).offset_chars)+1}–{Number(record(file.data).offset_chars)+Array.from(str(record(file.data).text)).length}
       {' / '}{str(record(file.data).total_chars)}
       {record(file.data).partial===true?' · '+tr('Показан фрагмент','Excerpt shown'):''}</>}</p>
    {ocrOffer&&<div className="advanced-form" role="group"
     aria-label={tr('Распознать сканированный PDF','Recognize scanned PDF')}>
     <p>{tr('На всех страницах нет извлекаемого текста. OCR создаёт новую копию через установленный OCRmyPDF после решения человека. Оригинал не изменяется.',
       'All pages lack extractable text. OCR makes a new copy with installed OCRmyPDF after human approval; the original stays unchanged.')}</p>
     <p>{tr('Страниц','Pages')}: {ocrOffer.pagesTotal} · SHA-256: {ocrOffer.sourceSha256}</p>
     <button type="button" disabled={readBusy}
      onClick={()=>onStartOcr({path:str(record(file.data).path),
       sha256:ocrOffer.sourceSha256,pagesTotal:ocrOffer.pagesTotal})}>
      {tr('Распознать PDF в задаче','Recognize PDF in Task')}</button>
    </div>}
    {record(file.data).format==='pdf'&&Number(record(file.data).missing_pdf_pages)>0&&
     <p role="status" className="advanced-notice">{tr(
      'В PDF есть страницы без извлекаемого текста: '+str(record(file.data).missing_pdf_pages)+
      '. Они могут быть пустыми или отсканированными. OCR не выполнялся.',
      'PDF pages without extractable text: '+str(record(file.data).missing_pdf_pages)+
      '. These may be blank or scanned pages. OCR was not performed.')}</p>}
    <pre className="document-content">{str(record(file.data).text)}</pre>
    <div className="advanced-actions">
     <button type="button" disabled={readBusy||Number(record(file.data).offset_chars)===0}
      onClick={()=>void readAt(str(record(file.data).path),str(record(file.data).sha256),0)}>
      {tr('К началу','First fragment')}</button>
     <button type="button" disabled={readBusy||backOffsets.length===0}
      onClick={()=>void readAt(str(record(file.data).path),str(record(file.data).sha256),
       backOffsets[backOffsets.length-1],false,'back')}>
      {tr('Предыдущий фрагмент','Previous fragment')}</button>
     <button type="button" disabled={readBusy||record(file.data).next_offset_chars===null}
      onClick={()=>void readAt(str(record(file.data).path),str(record(file.data).sha256),
       Number(record(file.data).next_offset_chars),false,'next')}>
      {tr('Следующий фрагмент','Next fragment')}</button>
    </div>
    <p>{tr('В задачу передаётся показанный текст, а не скрытая часть документа. Исходное имя, расположение и диапазон текста сохраняются в приложенном материале. При другом черновике приложение запросит разрешение на замену.',
      'The Task receives the visible excerpt, not the unseen rest of the document. Its original name, location and text range are included in the attachment. Replacing another draft requires your confirmation.')}</p>
    <button type="button" disabled={readBusy||!attachment}
      onClick={()=>{if(attachment)onAnalyze(attachment);}}>
     {tr('Использовать этот фрагмент в задаче','Use this excerpt in Task')}</button>
    <button type="button" disabled={readBusy||!attachment} onClick={()=>void analyzeWholeDocument()}>
     {tr('Использовать весь текст (до 48 КБ)','Use full text (up to 48 KB)')}</button>
    <OwnerDetails title={tr('Квитанция чтения','Read receipt')} value={file.receipt}/></>}
  </div>
  <div className="advanced-form"><h3>{tr('История подтверждённых чтений','Read receipt history')}</h3>
   {receipts.filter(r=>r.tool_id==='files.read').map(r=><div className="owner-row" key={str(r.receipt_id)}><strong>{tr('Чтение файла','File read')}</strong><span>{str(r.finished_at)}</span><details><summary>{tr('Основания','Evidence')}</summary><OwnerDetails value={r}/></details></div>)}
   <p>{tr('Квитанция чтения подтверждает обращение к инструменту, но не разрешает запись.','Read receipts prove the tool invocation, not write authority.')}</p>
  </div>
 </section>;
}
