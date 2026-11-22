import React,{useRef,useState} from 'react';
import {runtime,type InteractionTarget} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {OwnerDetails} from './owner-evidence';
import {workModeRecovery} from './work-mode-recovery';
export {OwnerDetails} from './owner-evidence';

/** Presentation helpers only. Every operation is owned and validated by Python. */
export type Row=Record<string,unknown>;
export function record(value:unknown):Row{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
}
export function records(value:unknown):Row[]{
  return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).map(record):[];
}
export function str(value:unknown):string{
  return typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):'';
}
export function failure(value:unknown):string{return value instanceof Error?value.message:String(value);}
/** Error wording for readers. A scrubbed diagnostic is available on demand. */
export function OwnerError({error,context}:{error:unknown;context?:string}){
  const {tr}=useUiSettings();
  const raw=failure(error),code=raw.toLowerCase();
  const recovery=workModeRecovery(raw);
  const explanation=recovery?tr(recovery.ru,recovery.en):/work_area_local_model_required/.test(code)
    ?tr('Для этой области нужна локальная модель. Выберите и проверьте IWXA LLM Engine или Ollama в разделе «Модели».','This area requires a local model. Select and verify IWXA LLM Engine or Ollama in Models.')
    :/work_area_(local_sources_forbidden|source_not_permitted)/.test(code)
    ?tr('Источник не разрешён в этой области. Уберите его или измените условия области.','This source is not allowed in this area. Remove it or edit the area settings.')
    :/work_area_(name|purpose)_invalid/.test(code)
    ?tr('Проверьте название и назначение. Название должно содержать до 90 символов, назначение - до 500, без переносов строк.','Check the name and purpose. Use a name of up to 90 characters and a purpose of up to 500, without line breaks.')
    :/(failed to fetch|network_error|econnrefused|connection refused)/.test(code)
    ?tr('Не удалось связаться с агентом. Проверьте соединение и обновите сведения.','Could not reach the assistant. Check the connection and refresh.')
    :/(owner_known_native_task_failure|known_native_task_failure|exact_task_failure_held)/.test(code)
    ?tr('Эта модель уже не справилась с точно таким заданием. Повторный запуск не предложен. Выберите другую модель или измените способ выполнения и проверьте результат.',
      'This model already failed this exact Task. No repeat run was proposed. Choose another model or a different approach and verify the result.')
    :/(basic_runtime_context_window_insufficient|basic_runtime_context_budget_too_large)/.test(code)
    ?tr('Запрошенный ответ вместе с исходным текстом не помещается в доступное контекстное окно модели. Уменьшите лимит токенов этого шага или выберите модель с большим контекстом.',
      'The requested output and input do not fit the available model context. Reduce this step output limit or select a model with a larger context.')
    :/(ollama_runtime_not_selected|runtime_adoption_runtime_not_selected)/.test(code)
    ?tr('Локальная модель ещё не подключена. Откройте «Программы» и завершите подключение.','The local model is not connected. Open Programs and finish setup.')
    :/(ollama_not_running|ollama_selected_endpoint_unavailable|ollama_daemon_readiness_timeout)/.test(code)
    ?tr('Ollama не отвечает. Откройте «Модели», проверьте подключение и запустите её.','Ollama is not responding. Open Models, check the connection and start it.')
    :/(local_document_destination_not_connected|local_document_destination_not_writable)/.test(code)
     ?tr('Папка для документов ещё не подключена для записи. Откройте «Подключения», выберите личную папку и разрешите запись.','The document folder is not connected for writing. Open Connections, choose a personal folder and enable writing.')
     :/local_document_destination_parent_not_directory/.test(code)
     ?tr('Папка назначения не найдена. Выберите существующую папку или укажите имя файла без подпапки.','The destination folder was not found. Choose an existing folder or enter a file name without subfolders.')
     :/local_document_draft_source_human_acceptance_required/.test(code)
     ?tr('Сначала откройте анализ и примите его в задаче. Затем можно подготовить файл.','Open and accept the analysis in the task before preparing a document.')
     :/local_document_update_has_no_changes/.test(code)
     ?tr('Содержимое не изменилось. Исправьте текст, если нужно обновить файл.','The content has not changed. Edit the text to update the file.')
     :/(local_document_draft_text_file_required|local_document_draft_output_out_of_bounds)/.test(code)
     ?tr('Проверьте имя файла и объём текста. Поддерживаются .txt и .md размером до 128 КБ.','Check the file name and text length. .txt and .md files up to 128 KB are supported.')
     :/(n8n_draft_local_only_forbidden|n8n_execution_(local_only|local_work_area|source_area_local_only)_forbidden)/.test(code)
    ?tr('В этой рабочей области запуск процессов ограничен. Проверьте условия области перед новым действием.','Workflows are restricted in this work area. Review its settings before creating another action.')
    :/n8n_execution_work_area_binding_missing/.test(code)
    ?tr('Не удалось подтвердить, к какой рабочей области относится процесс. Откройте исходную задачу и проверьте её привязку.','The workflow source area could not be verified. Open the source task and inspect its work area.')
    :/(n8n_local_health_not_verified|n8n_draft_provider_not_configured|n8n_draft_provider_not_selected)/.test(code)
    ?tr('Локальный n8n не готов. В разделе «Подключения» проверьте его адрес, ответ и выбор для процессов.','Local n8n is not ready. In Connections, check the address, service response and workflow selection.')
    :/(n8n_draft_target_not_approved|n8n_draft_workspace_changed)/.test(code)
    ?tr('Выбранный процесс или рабочая область изменились. Обновите перечень и подготовьте новое предложение.','The selected workflow or work area has changed. Refresh the list and prepare a new proposal.')
    :/(n8n_draft_message_invalid|n8n_draft_selection_invalid)/.test(code)
    ?tr('Проверьте текст и выбор процесса. Сообщение должно быть непустым и не превышать 4096 байт.','Check the message and workflow choice. The message must be nonempty and at most 4096 bytes.')
    :/(file_changed|update_source_changed)/.test(code)
    ?tr('Файл изменился после проверки. Откройте текущую версию и подготовьте новый план.','The file changed after review. Read its current version and prepare a new plan.')
    :/(readback|revision|stale|conflict)/.test(code)
    ?tr('Текущее состояние не подтверждено. Обновите сведения перед следующим действием.','The current state is unverified. Refresh before continuing.')
    :/(outcome_unknown|execution response lost|reconcile|ambiguous)/.test(code)
    ?tr('Результат предыдущего действия неизвестен. Проверьте его перед повтором.','The previous outcome is unknown. Check it before retrying.')
    :/(denied|forbidden|authority_required|not_authorized)/.test(code)
    ?tr('Недостаточно разрешений для этого действия. Проверьте условия доступа.','This action is not authorized. Check its permissions.')
    :tr('Не удалось завершить действие. Обновите сведения и проверьте причину.','Could not complete the action. Refresh and inspect the cause.');
  return <div className="advanced-error" role="alert">
    <p>{context?context+': ':''}{explanation}</p>
    <OwnerDetails title={tr('Подробности причины','Reason details')} value={raw}/>
  </div>;
}

export function useOwnerActions(reload:()=>Promise<unknown>){
  const {tr}=useUiSettings();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[diagnostic,setDiagnostic]=useState('');
  const inFlight=useRef(false);
  async function run<T=unknown>(label:string,command:string,input:Row,target?:InteractionTarget,options?:{confirmedBySelection?:boolean}):Promise<T|null>{
    // A synchronous ref guards against two submissions before React renders.
    // Choosing a model in the list itself confirms that choice. Consequential
    // commands keep the ordinary explicit confirmation dialog.
    const chosenModel=options?.confirmedBySelection===true&&['local_ai_model_select','provider_connection_configure','local_ai_inference_check'].includes(command);
    if(inFlight.current||(!chosenModel&&!window.confirm(label)))return null;
    inFlight.current=true;setBusy(true);setMessage('');setDiagnostic('');
    try{
      // InteractionClient already reads the current revision for targeted
      // commands. Keep the old preflight only where that client does not.
      if(!target||command==='ui_preferences_update')await runtime.refreshRevision();
      const result=await runtime.command<T>(command,input,target);
      try{
        await reload();
      }catch(error){
        // An acknowledgement does not prove the new state has been read back.
        // Do not move to the next step or send the command a second time.
        setMessage(tr(
          'Действие принято, но проверить новое состояние пока не удалось. Обновите сведения перед следующим шагом. Не отправляйте команду повторно без проверки.',
          'The action was acknowledged, but its new state could not be verified. Refresh before continuing. Do not repeat the command without checking.'
        ));
        setDiagnostic(failure(error));
        return null;
      }
      setMessage(tr('Действие подтверждено. Состояние обновлено.','The action was confirmed. Current information has been refreshed.'));
      return result;
    }catch(error){
      // The transport may have failed after the server performed the mutation.
      const recovery=workModeRecovery(error);
      setMessage(recovery?tr(recovery.ru,recovery.en):tr(
        'Результат действия неизвестен. Обновите сведения перед повтором.',
        'The outcome is unknown. Refresh the state before trying again.'
      ));
      setDiagnostic(failure(error));
      try{await reload();}catch{/* Preserve original failure. */}
      return null;
    }finally{inFlight.current=false;setBusy(false);}
  }
  return {run,busy,message,diagnostic,setMessage};
}
export function OwnerMessage({children,diagnostic}:{children:React.ReactNode;diagnostic?:string}){
  const {tr}=useUiSettings();
  return <div className="advanced-notice" role="status">
    <p>{children}</p>
    {diagnostic&&<OwnerDetails title={tr('Подробности действия','Action details')} value={diagnostic}/>}
  </div>;
}
