import React,{useState} from 'react';

// Only the original native Center .iwxa picker is used. No copy of private
// T3 verification, trust installation, or credential material exists in UI.
// A selected archive is NOT an admitted license or seat.
const MAX_TEST_IWXA=4*1024*1024;
type Preview={size:number;source:'IWXA_SELECTED_NOT_VERIFIED'};
type Props={organizationId:string;invoke:((command:string,args?:Record<string,unknown>)=>Promise<unknown>)|null};
function err(e:unknown){return e instanceof Error?e.message:String(e);}
export default function Cen04LicensePanel({organizationId,invoke}:Props){
 const [preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 async function open(){
   if(!invoke||busy)return;
   setBusy(true);setPreview(null);setError('');setMessage('');
   try{
     // Exact same native file chooser and bounded file reader already used by
     // Center CEN02/CEN03; package profile validation remains exclusively T3.
     const raw=await invoke('center_open_iwxa_file');
     if(raw===null){setMessage('Выбор пакета отменён.');return;}
     if(!Array.isArray(raw)||raw.length<4||raw.length>MAX_TEST_IWXA||
       raw.slice(0,4).some((v,i)=>v!==[80,75,3,4][i])||
       !raw.every(v=>Number.isInteger(v)&&v>=0&&v<=255))
       throw Error('CEN04_IWXA_CARRIER_BYTES_INVALID');
     // Do not cache or serialize untrusted license bytes as an organizational
     // draft. The trusted T3 Host will re-open/receive after native integration.
     setPreview({size:raw.length,source:'IWXA_SELECTED_NOT_VERIFIED'});
     setMessage('Пакет .iwxa выбран. Подпись, полномочия и текущий статус ещё не проверены T3.');
   }catch(e){setError('Не удалось открыть .iwxa: '+err(e));}
   finally{setBusy(false);}
 }
 return <section className="card padded" data-testid="cen04-test-license-panel">
   <h3>Лицензия Admin Center от Publisher</h3>
   <p className="muted">Выберите переданный Publisher пакет .iwxa. Его открытие не добавляет доверие к издателю, не сохраняет лицензию и не назначает мест.</p>
   <div className="actions">
     <button type="button" className="secondary" data-testid="cen04-select-test-iwxa"
       onClick={open} disabled={!invoke||busy}>{busy?'Открываем пакет…':'Открыть TEST .iwxa'}</button>
   </div>
   {!invoke&&<p className="muted">Выбор пакета доступен только в установленном Admin Center.</p>}
   {message&&<p role="status">{message}</p>}
   {error&&<p role="alert">{error}</p>}
   {preview&&<div data-testid="cen04-iwxa-unverified">
      <p><strong>Файл выбран. Проверка T3 ещё не выполнялась.</strong></p>
      <p>Объём: {preview.size} байт. Организация для независимой проверки: {organizationId}.</p>
      <p><strong>Подтверждённых мест: 0.</strong> Для приёма необходим оригинальный T3 Consumer с установленным вне пакета доверием.</p>
   </div>}
   <div className="notice subdued">TEST-лицензия и статус проверяются только оригинальным T3 Host. Коммерческая активация остаётся отключённой.</div>
 </section>;
}
