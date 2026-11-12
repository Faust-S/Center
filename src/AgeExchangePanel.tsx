import React,{useEffect,useRef,useState} from 'react';

// The same public UI is embedded in both Windows products. Native transport
// calls the separately bundled original T3 age/DPAPI owner. It never obtains
// private identities or decrypts a file in WebView.
type Invoke=(name:string,args?:Record<string,unknown>)=>Promise<any>;
type Status={operation:'AGE_STATUS';available:boolean;recipient:string|null;
  provider:string;toolchain:{ready:boolean;reason?:string};admitted:false};
const age1=/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
function verifiedStatus(value:any):Status{
  if(value?.operation!=='AGE_STATUS'||typeof value.available!=='boolean'||
     typeof value.toolchain?.ready!=='boolean'||value.admitted!==false||
     (value.available?typeof value.recipient!=='string'||!age1.test(value.recipient):
       value.recipient!==null&&value.recipient!==undefined))
    throw Error('AGE_DESKTOP_STATUS_INVALID');
  return value;
}
export default function AgeExchangePanel({invoke,prefix,onReady}:{
  invoke:Invoke|null;prefix:'center'|'publisher';onReady?:(ready:boolean)=>void
}){
  const [state,setState]=useState<Status|null>(null);
  const [recipients,setRecipients]=useState('');
  const [busy,setBusy]=useState(false);
  const operationRef=useRef(false);
  const [message,setMessage]=useState('');
  const [failure,setFailure]=useState('');
  const [details,setDetails]=useState('');
  const connected=Boolean(invoke);
  async function refresh(){
    if(!invoke)return;
    const next=verifiedStatus(await invoke(prefix+'_age_status'));
    setState(next);onReady?.(next.toolchain.ready);
  }
  useEffect(()=>{
    let live=true;
    if(!invoke){onReady?.(false);return;}
    invoke(prefix+'_age_status').then((next:Status)=>{
      if(live){
        const verified=verifiedStatus(next);
        setState(verified);onReady?.(verified.toolchain.ready);
      }
    }).catch(e=>{
      if(live){onReady?.(false);
        setFailure('Защищённый обмен недоступен: '+String(e));}
    });
    return()=>{live=false;onReady?.(false);};
  },[invoke,prefix,onReady]);
  async function perform(action:'create_recipient'|'inspect'|'encrypt'|'decrypt'){
    if(!invoke||busy||operationRef.current)return;
    operationRef.current=true;
    setBusy(true);setMessage('');setFailure('');setDetails('');
    try{
      const data=await invoke(prefix+'_age_'+action,
        action==='encrypt'?{recipients}:undefined);
      if(data===null){setMessage('Выбор файла отменён. Данные не изменены.');return;}
      const expected={
        create_recipient:'AGE_RECIPIENT_CREATED',
        inspect:'AGE_INSPECTED',encrypt:'AGE_ENCRYPTED',
        decrypt:'AGE_DECRYPTED'
      }[action];
      if(data?.operation!==expected||data.admitted!==false)
        throw Error('AGE_DESKTOP_RECEIPT_INVALID');
      if(action==='encrypt'&&data.deliveryState!=='NOT_CONFIRMED')
        throw Error('AGE_DESKTOP_EXPORT_RECEIPT_INVALID');
      if(action==='decrypt'&&data.state!=='DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED')
        throw Error('AGE_DESKTOP_DECRYPT_RECEIPT_INVALID');
      if(action==='create_recipient'){
        await refresh();
        setMessage('Локальный X25519-ключ создан в T3 и защищён Windows DPAPI.');
      }else if(action==='encrypt'){
        setMessage('Файл .iwxa.age сохранён. Доставка получателю не подтверждена.');
      }else if(action==='decrypt'){
        setMessage('Исходный .iwxa восстановлен. Подпись, получатель и права должны быть отдельно проверены T3 при приёме.');
      }else{
        setMessage('Заголовок age проверен. Это не подтверждает владельца ключа или подлинность пакета.');
      }
      setDetails(JSON.stringify({
        packageSha256:data.sourceSha256??null,
        ciphertextSha256:data.ciphertextSha256??null,
        recipientCount:data.recipientCount??data.recipientStanzas??null,
        admitted:false
      }));
    }catch(e){setFailure(e instanceof Error?e.message:String(e));}
    finally{operationRef.current=false;setBusy(false);}
  }
  async function copyPublicRecipient(){
    const recipient=state?.recipient;
    if(!state?.available||!recipient||!age1.test(recipient))return;
    setFailure('');setMessage('');
    try{
      if(!navigator.clipboard?.writeText)throw Error('AGE_CLIPBOARD_NOT_AVAILABLE');
      await navigator.clipboard.writeText(recipient);
      setMessage('Публичный ключ получателя скопирован. Перед передачей проверьте его принадлежность получателю.');
    }catch{
      setFailure('Автоматическое копирование недоступно. Выделите открытый ключ в поле выше и скопируйте вручную.');
    }
  }
  const canUse=connected&&state?.toolchain?.ready===true;
  return <section className="card padded" data-testid={prefix+'-age-exchange'}>
    <h3>Защищённый обмен .iwxa.age</h3>
    <p className="muted">Используется исходный T3 age/X25519. Шифрование не заменяет подпись,
      организационное разрешение и подтверждение получения файла.</p>
    {!connected&&<p role="status">Обмен доступен только в установленном Windows-приложении.</p>}
    {connected&&state&&!state.toolchain.ready&&
      <p role="status">Криптографический компонент T3 не готов: {state.toolchain.reason??'проверенные age и age-keygen отсутствуют'}.</p>}
    {state&&<div className="nested-form">
      <strong>Локальный получатель</strong>
      {state.available?<div className="nested-form">
        <input aria-label="Открытый ключ получателя age1" readOnly
          data-testid={prefix+'-age-public-key'} value={state.recipient??''}
          onFocus={e=>e.currentTarget.select()}/>
        <button type="button" className="secondary" disabled={busy}
          data-testid={prefix+'-age-copy-recipient'}
          onClick={()=>void copyPublicRecipient()}>Скопировать публичный ключ</button>
      </div>:<p className="muted" data-testid={prefix+'-age-public-key'}>
        Ключ получателя ещё не создан</p>}
      <button type="button" className="secondary" disabled={!canUse||busy||state.available}
        onClick={()=>void perform('create_recipient')}>Создать ключ получателя</button>
    </div>}
    <label>Открытые ключи получателей age1 (по одному на строке, 1–16)
      <textarea rows={3} spellCheck={false} value={recipients}
        onChange={e=>setRecipients(e.target.value)}
        placeholder="age1…" data-testid={prefix+'-age-recipients'}/>
    </label>
    <p className="muted">Ключи нужно получить из доверенного источника и отдельно
      проверить принадлежность получателю. Ввод ключа сам по себе не устанавливает доверие.</p>
    <div className="actions">
      <button className="primary" disabled={!canUse||busy||!recipients.trim()}
        data-testid={prefix+'-age-encrypt'} onClick={()=>void perform('encrypt')}>
        Зашифровать .iwxa</button>
      <button className="secondary" disabled={!canUse||busy}
        data-testid={prefix+'-age-decrypt'} onClick={()=>void perform('decrypt')}>
        Расшифровать .iwxa.age</button>
      <button className="secondary" disabled={!connected||busy}
        data-testid={prefix+'-age-inspect'} onClick={()=>void perform('inspect')}>
        Проверить заголовок</button>
    </div>
    {message&&<p role="status" data-testid={prefix+'-age-success'}>{message}</p>}
    {failure&&<p role="alert" data-testid={prefix+'-age-error'}>{failure}</p>}
    {details&&<small className="muted">{details}</small>}
  </section>;
}
