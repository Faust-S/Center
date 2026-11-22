import React, {useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';

export type DomainObjectSelection = {
  path: string;
  package_sha256: string;
  workspace_id: string;
  object_id: string;
  revision: number;
};

type DomainObject = {
  workspace_id: string;
  object_id: string;
  revision: number;
  schema_id: string;
  updated_by_service: string;
  display_title?: string;
  updated_at?: string;
  deleted?: boolean;
};
type DomainPreview = {
  adapter_version: string;
  profile: string;
  package_sha256: string;
  counts: {objects:number;workspaces:number};
  objects: DomainObject[];
  offset: number;
  next_offset: number|null;
  preview_truncated: boolean;
  receipt_status: string;
};
type Props = {
  disabled: boolean;
  onUse: (selection:DomainObjectSelection, selectedText:string) => Promise<void>;
};
const SHA = /^[a-f0-9]{64}$/;

/** Optional file-only source UI. No network, file scan or Kernel at startup. */
export function T2DomainResultControl({disabled,onUse}: Props) {
  const {tr} = useUiSettings();
  const [path,setPath] = useState('');
  const [preview,setPreview] = useState<DomainPreview|null>(null);
  const [selected,setSelected] = useState<DomainObjectSelection|null>(null);
  const [selectedText,setSelectedText] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  async function chooseFile() {
    if(busy||disabled)return;
    setBusy(true);setError('');setSuccess('');
    try{
      const result=await runtime.command<{selected:boolean;cancelled:boolean;path?:string;unavailable?:string}>(
        't2_domain_file_choose',{});
      if(result.selected&&result.path){setPath(result.path);setPreview(null);setSelected(null);}
      else if(result.unavailable)setError(tr('Выбор файла недоступен. Введите путь .iwxa вручную.',
        'File picker unavailable. Enter the .iwxa path manually.'));
    }catch(e){setError(String(e instanceof Error?e.message:e))}
    finally{setBusy(false);}
  }
  async function inspect(offset=0) {
    if(busy||disabled||!path.toLowerCase().endsWith('.iwxa'))return;
    setBusy(true);setError('');setSuccess('');setSelected(null);setSelectedText('');
    try{
      const result=await runtime.query<DomainPreview>('t2_domain_file_preview',{path,offset});
      if(result.profile!=='iwxa.package/1.0'||!SHA.test(result.package_sha256)||
          !Array.isArray(result.objects)||!Number.isInteger(result.offset)||
          result.offset!==offset||!Number.isInteger(result.counts.objects))
        throw Error('t2_domain_preview_unverified');
      setPreview(result);
    }catch(e){setPreview(null);setError(String(e instanceof Error?e.message:e))}
    finally{setBusy(false);}
  }
  async function inspectObject(object:DomainObject) {
    if(busy||disabled||!preview||!SHA.test(preview.package_sha256))return;
    setBusy(true);setError('');setSuccess('');setSelected(null);
    const choice:DomainObjectSelection={path,package_sha256:preview.package_sha256,
      workspace_id:object.workspace_id,object_id:object.object_id,revision:object.revision};
    try{
      const value=await runtime.query<{text:string;reference:{workspace_id:string;object_id:string;revision:number;package_sha256:string}}>(
        't2_domain_file_result',choice);
      if(value.reference.package_sha256!==choice.package_sha256||
          value.reference.workspace_id!==choice.workspace_id||
          value.reference.object_id!==choice.object_id||
          value.reference.revision!==choice.revision||typeof value.text!=='string')
        throw Error('t2_domain_selected_result_unverified');
      setSelected(choice);setSelectedText(value.text);
    }catch(e){setError(String(e instanceof Error?e.message:e))}
    finally{setBusy(false);}
  }
  async function addToTask(){
    if(busy||disabled||!selected)return;
    setBusy(true);setError('');setSuccess('');
    try{
      await onUse(selected,selectedText);
      setSuccess(tr('Результат добавлен к сохранённому черновику задачи.',
        'Result added to the saved task draft.'));
      setSelected(null);setSelectedText('');
    }catch(e){setError(String(e instanceof Error?e.message:e))}
    finally{setBusy(false);}
  }
  return <details className="subpage card" aria-label={tr('Результат из продукта IWXA','Result from an IWXA product')}>
    <summary>{tr('Добавить результат из продукта IWXA (.iwxa)','Use a result from an IWXA product (.iwxa)')}</summary>
    <p>{tr('Выберите ранее экспортированный пакет. Другой продукт и его Kernel не запускаются.',
      'Choose an exported package. No other product or Kernel is launched.')}</p>
    <div className="composer-options">
      <label>{tr('Файл .iwxa','.iwxa file')}
        <input aria-label={tr('Путь к пакету .iwxa','Path to .iwxa package')} type="text"
          value={path} disabled={disabled||busy} placeholder={tr('Укажите путь к файлу','Enter file path')}
          onChange={e=>{setPath(e.target.value);setPreview(null);setSelected(null);setSuccess('')}}/>
      </label>
      <button type="button" disabled={disabled||busy} onClick={()=>void chooseFile()}>
        {tr('Выбрать файл','Choose file')}
      </button>
      <button type="button" disabled={disabled||busy||!path.toLowerCase().endsWith('.iwxa')}
        onClick={()=>void inspect()}>{tr('Показать результаты','Show results')}</button>
    </div>
    {error&&<p role="alert">{error}</p>}
    {success&&<p role="status">{success}</p>}
    {preview&&<div>
      <p role="status">{tr('Объектов','Objects')}: {preview.counts.objects} ·
        {tr('Рабочих областей','Workspaces')}: {preview.counts.workspaces} ·
        {tr('Квитанция экспорта в файл не включена','Export receipt is not embedded')}</p>
      <div className="task-list">
        {preview.objects.map(item=><div className="task-row" key={item.workspace_id+'|'+item.object_id}>
          <strong>{item.display_title||item.schema_id}</strong>
          <small>{item.schema_id} · {tr('Ревизия','Revision')} {item.revision}</small>
          <small>{item.updated_by_service} · {item.workspace_id}</small>
          {item.deleted===true&&<small>{tr('Удалённый объект','Deleted object')}</small>}
          <button type="button" disabled={disabled||busy||item.deleted===true} onClick={()=>void inspectObject(item)}>
            {tr('Просмотреть','Preview')}
          </button>
        </div>)}
      </div>
      {selected&&<section aria-label={tr('Предпросмотр результата','Result preview')}>
        <h3>{tr('Текст выбранного объекта','Selected object text')}</h3>
        <pre className="document-text">{selectedText}</pre>
        <button type="button" disabled={disabled||busy} onClick={()=>void addToTask()}>
          {tr('Добавить результат в задачу','Add result to task')}
        </button>
      </section>}
      {!preview.objects.length&&<p>{tr('В этом диапазоне нет объектов.','No objects in this range.')}</p>}
      <div className="composer-options">
        <button type="button" disabled={disabled||busy||preview.offset===0}
          onClick={()=>void inspect(Math.max(0,preview.offset-40))}>{tr('Назад','Previous')}</button>
        <span>{tr('С','From')} {preview.offset+1} · {tr('Показано','Shown')} {preview.objects.length}</span>
        <button type="button" disabled={disabled||busy||preview.next_offset===null}
          onClick={()=>void inspect(preview.next_offset||0)}>{tr('Далее','Next')}</button>
      </div>
    </div>}
  </details>;
}
