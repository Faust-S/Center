/** P04 optional Obsidian note, existing InteractionSurface owner remains authoritative. */
import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
export type ObsidianSelection={vault_path:string;note_path:string;revision:string};
type Preview={ownerProduct:string;vaultName:string;notePath:string;noteTitle:string;revision:string;status:string};
export type ExternalObjectLink={ownerProduct:string;objectRef?:{notePath?:string;sourceRef?:string};savedContext?:{title:string};status:string;navigation?:{mode:string;uri?:string}|null};
type Tr=(ru:string,en:string)=>string;
export function ObsidianNotePicker({selection,onSelect,disabled,tr}:{selection:ObsidianSelection|null;onSelect:(v:ObsidianSelection|null)=>void;disabled:boolean;tr:Tr}){
 const[vault,setVault]=useState(''),[note,setNote]=useState('');
 const[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const epoch=useRef(0);
 useEffect(()=>()=>{epoch.current+=1;},[]);
 function invalidate(){epoch.current+=1;setPreview(null);setError('');setBusy(false);onSelect(null);}
 async function inspect(){
  if(disabled||busy||!vault.trim()||!note.trim())return;
  const ticket=++epoch.current,folder=vault.trim(),rel=note.trim();
  setPreview(null);setError('');setBusy(true);onSelect(null);
  try{
   const p=await runtime.query<Preview>('obsidian_note_preview',{vault_path:folder,note_path:rel});
   if(ticket!==epoch.current)return;
   if(p.ownerProduct!=='Obsidian'||p.notePath!==rel||!(/^[0-9a-f]{64}$/).test(p.revision)||p.status!=='SOURCE_REVISION_MATCHES')throw Error('obsidian_preview_invalid');
   setPreview(p);
  }catch(e){if(ticket===epoch.current)setError(tr('Заметка недоступна или изменилась.','Note unavailable or changed.')+' '+String(e instanceof Error?e.message:e));}
  finally{if(ticket===epoch.current)setBusy(false);}
 }
 return <details className="composer-options" aria-label={tr('Связать заметку Obsidian','Link Obsidian note')}>
  <summary>{tr('Связать заметку Obsidian (необязательно)','Link an Obsidian note (optional)')}{selection?' ✓':''}</summary>
  <label>{tr('Папка Vault','Vault folder')}<input type="text" value={vault} disabled={disabled} onChange={(e:{target:{value:string}})=>{setVault(e.target.value);invalidate();}}/></label>
  <label>{tr('Заметка внутри Vault','Note inside Vault')}<input type="text" value={note} disabled={disabled} placeholder="Clients/Proposal.md" onChange={(e:{target:{value:string}})=>{setNote(e.target.value);invalidate();}}/></label>
  <button type="button" className="mini-button" disabled={disabled||busy||!vault.trim()||!note.trim()} onClick={()=>void inspect()}>{tr('Проверить заметку','Inspect note')}</button>
  {error&&<p role="alert">{error}</p>}
  {preview&&<p>{preview.vaultName} / {preview.noteTitle} <button type="button" className="mini-button" disabled={disabled} onClick={()=>onSelect({vault_path:vault.trim(),note_path:preview.notePath,revision:preview.revision})}>{tr('Выбрать','Select')}</button></p>}
  {selection&&<p role="status">{tr('Выбрана заметка','Selected note')}: {selection.note_path} <button type="button" className="mini-button" disabled={disabled} onClick={()=>onSelect(null)}>{tr('Убрать','Remove')}</button></p>}
 </details>;
}
const LABELS:Record<string,[string,string]>={SOURCE_REVISION_MATCHES:['Актуально','Current'],SOURCE_REVISION_CHANGED:['Устарело','Stale'],SOURCE_IDENTITY_CHANGED:['Другой Vault','Different Vault'],SOURCE_UNAVAILABLE:['Источник недоступен','Source unavailable'],WORKSPACE_NOT_SELECTED:['Другая Workspace','Different Workspace'],SOURCE_NOT_PERMITTED:['Нет разрешения','Not permitted'],INVALID_REFERENCE:['Повреждённая ссылка','Invalid link'],REOBSERVE_REQUIRED:['Требуется повторное подключение','Reconnection required']};
export function ExternalContextStatus({links,tr}:{links:ExternalObjectLink[];tr:Tr}){
 return <section className="owner-rows" aria-label={tr('Связанные приложения','Linked applications')}>
  <strong>{tr('Связанные приложения','Linked applications')}</strong>
  {links.map((link,i)=>{
   const label=LABELS[link.status]||[link.status,link.status];
   const name=link.savedContext?.title||link.objectRef?.notePath||link.objectRef?.sourceRef||link.ownerProduct;
   const uri=link.navigation?.mode==='EXTERNAL_URI'&&typeof link.navigation.uri==='string'&&link.navigation.uri.startsWith('obsidian://open?')?link.navigation.uri:null;
   return <div className="owner-row" key={link.ownerProduct+'-'+i}>
    <span>{link.ownerProduct}: {name} — {tr(...label)}</span>
    {uri&&<a href={uri}>{tr('Открыть заметку','Open note')}</a>}
    {link.status==='REOBSERVE_REQUIRED'&&<small>{tr('Повторно подключите программу через раздел «Программы». Сохранённая ссылка не восстанавливает живую вкладку или окно.','Reconnect through Programs. A saved reference does not restore a live tab or window.')}</small>}
   </div>;
  })}
 </section>;
}
