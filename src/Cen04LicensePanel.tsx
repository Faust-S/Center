import React,{useState} from 'react';
import {inspectCen04TestDeliveryText} from '../runtime/cen04-test-delivery-preview.mjs';

// No signing, no local trust installation, no seat assignment in this panel.
// It only opens a local file via the installed Tauri desktop and labels every
// claim unverified until an original T3 native consumer is connected.
type Preview={status:string;licenseId:string;claimedSeats:number;
 claimedStatus:string;claimedSequence:number;activeSeats:number;assignableSeats:number;};
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
   const selected=await invoke('center_cen04_open_test_delivery_file');
   if(selected===null){setMessage('Выбор TEST-файла отменён.');return;}
   if(typeof selected!=='string')throw Error('CEN04_NATIVE_FILE_INVALID');
   const report=inspectCen04TestDeliveryText(selected,{organizationId}) as Preview;
   setPreview(report);
   setMessage('Файл выбран для предварительного просмотра. T3 пока не проверил подпись и статус.');
  }catch(e){setError('Файл не принят для просмотра: '+err(e));}
  finally{setBusy(false);}
 }
 return <section className="card padded" data-testid="cen04-test-license-panel">
   <h3>Лицензия Admin Center от Publisher</h3>
   <p className="muted">Можно выбрать подписанную пару TEST-лицензии и статуса из файла. Это ещё не импорт в T3 и не выдача доступа.</p>
   <div className="actions">
    <button type="button" className="secondary" data-testid="cen04-select-test-file"
      onClick={open} disabled={!invoke||busy}>{busy?'Открываем файл…':'Выбрать TEST-файл'}</button>
   </div>
   {!invoke&&<p className="muted">Выбор файла доступен только в установленном Admin Center.</p>}
   {message&&<p role="status">{message}</p>}
   {error&&<p role="alert">{error}</p>}
   {preview&&<div data-testid="cen04-unverified-preview">
     <p><strong>Заявка из файла:</strong> {preview.licenseId}</p>
     <p>Заявленный статус: <strong>{preview.claimedStatus} (не проверен)</strong>,
        последовательность: {preview.claimedSequence}, мест в заявке: {preview.claimedSeats}.</p>
     <p><strong>Подтверждённые места: 0.</strong> Для проверки подписи, статуса и сохранения необходим отдельный доверенный T3 Host.</p>
   </div>}
   <div className="notice subdued">Подписанный TEST-файл сам не устанавливает доверие к издателю. Коммерческая активация и распределение мест отключены.</div>
 </section>;
}
