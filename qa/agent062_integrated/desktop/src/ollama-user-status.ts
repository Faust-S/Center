/**
 * Human-facing Ollama status is projected by the existing Core owner.
 * All desktop surfaces use the same stage; a failed server probe is not
 * evidence that a program needs installing.
 */
export type UserReadiness={
 stage?:string; next_action?:string;
 installation_observed?:boolean|null; source_confirmed?:boolean;
 server_responding?:boolean; model_available?:boolean;provider_active?:boolean;
 response_verified?:boolean;
};
export type Translate=(ru:string,en:string)=>string;

export function ollamaStageText(state:UserReadiness|undefined|null,tr:Translate):string{
 switch(state?.stage){
  case 'PROGRAM_NOT_DETECTED': return tr(
   'Ollama не найдена в известных местах и сервер не отвечает. Проверьте программу в Центре программ, прежде чем устанавливать её.',
   'Ollama was not found in known locations and its server is not responding. Check Programs before installing it.');
  case 'SOURCE_NOT_CONNECTED': return tr(
   'Ollama обнаружена или источник ещё не выбран. Подключите существующую Ollama в разделе «Модели»; переустановка не требуется.',
   'Ollama was detected or its source is not selected. Connect the existing Ollama in Models; reinstalling is not required.');
  case 'SERVER_UNAVAILABLE': return tr(
   'Ollama подключена, но локальный сервер не отвечает. Запустите установленную Ollama или проверьте адрес. Переустанавливать программу не нужно.',
   'Ollama is connected, but its local server is not responding. Start Ollama or check the endpoint. Reinstallation is not needed.');
  case 'MODEL_NOT_AVAILABLE': return tr(
   'Сервер Ollama отвечает. Выберите доступную локальную модель или загрузите её в разделе «Модели».',
   'The Ollama server responds. Select an available local model or download one in Models.');
  case 'MODEL_NOT_ACTIVE': return tr(
   'Выбранная модель найдена. Назначьте Ollama для выполнения новых задач.',
   'The selected model is available. Activate Ollama for new tasks.');
  case 'RESPONSE_NOT_VERIFIED': return tr(
   'Модель назначена. Для подтверждения её работы выполните отдельную проверку ответа; это не оценка качества модели.',
   'The model is selected. Verify a real response separately; this is not a model-quality assessment.');
  case 'READY': return tr(
   'Ollama отвечает, выбранная модель доступна, последний проверочный запрос выполнен.',
   'Ollama responds, the selected model is available and the latest verification request succeeded.');
  default: return tr(
   'Состояние Ollama пока не подтверждено. Обновите проверку перед изменением программы или моделей.',
   'Ollama status is not yet verified. Refresh the check before changing programs or models.');
 }
}
export const ollamaNextPage=(state:UserReadiness|undefined|null):'Программы'|'Модели'=>
 state?.next_action==='OPEN_PROGRAMS'?'Программы':'Модели';

/**
 * Human-facing guidance for the regular Task composer. This is a read-only
 * projection of Core snapshots, not an inference or activation gate.
 * In particular an unverified read must never be called "no model installed".
 */
export type RequestModelHint='MODEL_REQUIRED'|'STATUS_UNVERIFIED'|null;
export function requestModelHint(
 activeProvider:unknown,setup:unknown,readiness:UserReadiness|null
):RequestModelHint{
 if(typeof activeProvider!=='string'||!activeProvider.trim())return 'STATUS_UNVERIFIED';
 if(activeProvider==='NONE')return 'MODEL_REQUIRED';
 if(activeProvider==='IWXA_BASIC_RUNTIME_V1'){
  // The active IWXA GGUF can be selected but stopped or missing. Do not
  // describe it as ready merely because its provider slot is configured.
  if(!setup||typeof setup!=='object'||Array.isArray(setup))
   return 'STATUS_UNVERIFIED';
  const health=(setup as {active_model_health?:{ready?:unknown}}).active_model_health;
  if(typeof health?.ready!=='boolean')return 'STATUS_UNVERIFIED';
  return health.ready?null:'MODEL_REQUIRED';
 }
 if(activeProvider!=='OLLAMA_LOCAL_V1')return null;
 if(setup===null||typeof setup!=='object'||Array.isArray(setup)||!readiness)
  return 'STATUS_UNVERIFIED';
 if((setup as {first_run_required?:unknown}).first_run_required===true)return 'MODEL_REQUIRED';
 return readiness.stage==='READY'?null:'MODEL_REQUIRED';
}
