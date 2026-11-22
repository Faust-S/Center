/**
 * IWXA Personal desktop transport. Existing PA.CONTRACT.INTERACTION_SURFACE@1.0.0
 * remains the only authority for commands, permissions, state and receipts.
 * Queries return envelope.data; commands return envelope.data.result.
 */
import {renewDesktopSession} from './session-bootstrap';
import {receiveRuntimeResponse,ResponseReadFailure} from './response-deadline';
export type SessionNotice='recovering'|'restored'|'failed';
export type InteractionTarget={kind:string;id:string};
export type RuntimeErrorCode='STALE_ETAG_OR_REVISION'|'OFFLINE_COMMAND_DENIED'|'AUTHORITY_REQUIRED'|string;
type ErrorBody={error?:{code?:string;message?:string}|string};
type Envelope<T>={kind:'InteractionSnapshot'|'CommandAck';backend_contract_version:string;snapshot_revision:string;data:T};
type CommandAck<T>={accepted:boolean;command:string;ack_id:string;result:T;queued_for_replay?:boolean};
// Shell choosers return a selected path only: no Core mutation, no authority.
const nativePathPickers=new Set([
  'local_file_folder_choose','program_install_folder_choose','obsidian_vault_choose',
  'local_model_choose_file','local_ai_native_gguf_choose','local_ai_basic_gguf_choose',
  't2_domain_file_choose','atlas_file_choose',
]);

export class RuntimeRequestError extends Error {
  constructor(message:string,readonly code:RuntimeErrorCode,readonly status:number){
    super(message);
    this.name='RuntimeRequestError';
  }
}

export class InteractionClient {
  private revision='';
  private locale:'ru'|'en'='ru';
  private sessionEpoch=0;
  private readyEpoch=0;
  private sessionRenewal:Promise<void>|null=null;
  private sessionNotice:SessionNotice|null=null;
  private sessionListeners=new Set<(notice:SessionNotice)=>void>();
  onSessionNotice(listener:(notice:SessionNotice)=>void):()=>void{
    this.sessionListeners.add(listener);
    if(this.sessionNotice)listener(this.sessionNotice);
    return()=>{this.sessionListeners.delete(listener);};
  }
  private notify(notice:SessionNotice){
    this.sessionNotice=notice;
    for(const listener of this.sessionListeners)listener(notice);
  }
  setLocale(locale:'ru'|'en'){this.locale=locale;}
  get snapshotRevision(){return this.revision;}


  private async renew():Promise<void>{
    if(this.sessionRenewal)return this.sessionRenewal;
    // Revisions from the previous Core process are no longer authoritative.
    this.sessionEpoch++;
    this.revision='';
    this.notify('recovering');
    const work=(async()=>{
      try{
        await renewDesktopSession();
        // Refresh the Core-owned revision before accepting another mutation.
        await this.request('query',{query:'status',params:{}},true);
        this.readyEpoch=this.sessionEpoch;
        this.notify('restored');
      }catch{
        this.notify('failed');
        throw new RuntimeRequestError('Не удалось восстановить локальную сессию. Черновики остаются в открытом окне.',
          'LOCAL_SESSION_RECOVERY_FAILED',401);
      }
    })();
    this.sessionRenewal=work;
    try{await work;}finally{if(this.sessionRenewal===work)this.sessionRenewal=null;}
  }
  async recoverSession():Promise<void>{await this.renew();}

  private async lostSession<T>(kind:'query'|'command',body:Record<string,unknown>,epoch:number,retried:boolean):Promise<Envelope<T>>{
    if(retried)throw new RuntimeRequestError('Локальная сессия недоступна. Запрос повторно не отправлен.',
      'LOCAL_SESSION_RECOVERY_FAILED',401);
    if(epoch===this.sessionEpoch){
      await this.renew();
    }else{
      if(this.sessionRenewal)await this.sessionRenewal;
      if(this.readyEpoch!==this.sessionEpoch)
        throw new RuntimeRequestError('Восстановление локальной сессии не подтверждено.',
          'LOCAL_SESSION_RECOVERY_FAILED',401);
    }
    if(kind==='query')return this.request<T>(kind,body,true);
    // A command may have taken effect before the transport failed. Never replay it.
    throw new RuntimeRequestError('Соединение восстановлено. Проверьте результат в истории перед повтором действия.',
      'ACTION_OUTCOME_UNCONFIRMED',401);
  }

  private async request<T>(kind:'query'|'command',body:Record<string,unknown>,retried=false):Promise<Envelope<T>>{
    const epoch=this.sessionEpoch;
    let response:Response,parsed:unknown;
    // Reads and this bounded local review must not leave the UI pending
    // indefinitely. Native choosers and long inference/install commands retain
    // their existing lifetime; no command is ever automatically replayed.
    const deadline=kind==='query'?15000:body.command==='memory_review'?20000:0;
    try {
      ({response,parsed}=await receiveRuntimeResponse('/api/interaction/'+kind,{
        method:'POST',credentials:'same-origin',mode:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contract_version:'1.0.0',surface:'builtin_web',locale:this.locale,...body}),
      },deadline));
    }catch(error){
      if(error instanceof ResponseReadFailure&&error.phase==='deadline'){
        if(kind==='query')throw new RuntimeRequestError(
          'Локальное ядро не ответило вовремя. Повторите чтение.',
          'CORE_QUERY_TIMEOUT',0);
        throw new RuntimeRequestError(
          'Ответ на решение не получен вовремя. Проверьте сохранённое решение перед повтором. Команда повторно не отправлена.',
          'ACTION_OUTCOME_UNCONFIRMED',0);
      }
      if(error instanceof ResponseReadFailure&&error.phase==='body'){
        if(kind==='command')throw new RuntimeRequestError(
          'Ответ действия не прочитан. Проверьте его результат перед повтором.',
          'ACTION_OUTCOME_UNCONFIRMED',error.status);
        throw new RuntimeRequestError('Некорректный ответ локального Runtime',
          'INVALID_RUNTIME_RESPONSE',error.status);
      }
      if(kind==='query')return this.lostSession<T>(kind,body,epoch,retried);
      if(!retried)void this.renew().catch(()=>{});
      throw new RuntimeRequestError('Соединение прервалось. Проверьте результат действия в истории перед повтором.',
        'ACTION_OUTCOME_UNCONFIRMED',0);
    }
    if(epoch!==this.sessionEpoch)return this.lostSession<T>(kind,body,epoch,retried);
    if(response.status===401)return this.lostSession<T>(kind,body,epoch,retried);
    const payload=(parsed&&typeof parsed==='object'?parsed:{}) as ErrorBody&Partial<Envelope<T>>;
    if(epoch!==this.sessionEpoch)return this.lostSession<T>(kind,body,epoch,retried);
    if(!response.ok){
      const e=payload.error;
      const code=typeof e==='object'&&e?String(e.code||'RUNTIME_REQUEST_FAILED'):'RUNTIME_REQUEST_FAILED';
      const detail=typeof e==='object'&&e?e.message:typeof e==='string'?e:undefined;
      const msg=code==='STALE_ETAG_OR_REVISION'?'Состояние изменилось. Обновите задачу и подтвердите действие заново.':
        detail||'Runtime отклонил операцию';
      throw new RuntimeRequestError(msg,code,response.status);
    }
    if(payload.backend_contract_version!=='1.0.0'||
       payload.kind!==(kind==='query'?'InteractionSnapshot':'CommandAck')||
       !payload.data||typeof payload.data!=='object'){
      if(kind==='command')throw new RuntimeRequestError('Ответ действия не подтверждён. Проверьте историю перед повтором.',
        'ACTION_OUTCOME_UNCONFIRMED',response.status);
      throw new RuntimeRequestError('Версия или структура ответа Runtime не соответствует контракту', 'INVALID_RUNTIME_ENVELOPE',response.status);
    }
    // Live progress and queued-job ACKs are read-only observations. Their
    // cached token must never replace the fresh token used for authorizing
    // a later targeted command.
    const observation=kind==='query'&&['quick_chat_history','quick_chat_status','interactive_submission_status','session_catalog',
      'session_status','session_search'].includes(String(body.query||''));
    const queuedAck=kind==='command'&&(body.command==='quick_chat_submit' ||
      body.command==='submit_task'&&(body.input as Record<string,unknown>|undefined)?.background===true);
    const chooserAck=kind==='command'&&nativePathPickers.has(String(body.command||''));
    if(!observation&&!queuedAck&&!chooserAck&&typeof payload.snapshot_revision==='string'&&payload.snapshot_revision)
      this.revision=payload.snapshot_revision;
    return payload as Envelope<T>;
  }

  async query<T>(query:string,params:Record<string,unknown>={}):Promise<T>{
    return (await this.request<T>('query',{query,params})).data;
  }

  async command<T>(command:string,input:Record<string,unknown>,target?:InteractionTarget):Promise<T>{
    // A targeted mutation must use a fresh owner revision, not a UI
    // observation returned while a background model call was running.
    const chooser=nativePathPickers.has(command);
    if(target&&command!=='ui_preferences_update'&&!chooser)await this.query('status');
    const envelope=await this.request<CommandAck<T>>('command',{
      command,input,
      ...(target?{target}:{}),
      ...(this.revision&&!chooser?{snapshot_revision:this.revision}:{}),
      // This is the legacy transport's 'offline replay' flag, NOT the T3
      // LOCAL_ONLY sovereign policy. Local commands must work without WAN.
      offline:false,
    });
    if(envelope.data.accepted!==true||envelope.data.command!==command)
      throw new RuntimeRequestError('Команда не подтверждена локальным Runtime','UNCONFIRMED_COMMAND',200);
    return envelope.data.result;
  }

  async refreshRevision(){await this.query('status');}
}
export const runtime=new InteractionClient();
