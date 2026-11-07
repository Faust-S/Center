// Narrow installed Tauri IPC consumer. The OS, executable, and window are
// exclusively selected and validated by Center's native host.
const valid = x => typeof x==='string'&&x.length>0&&x.length<=256;
const validWork = x => x&&valid(x.organizationId)&&valid(x.projectId)&&
  valid(x.workId)&&typeof x.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(x.revision);
const checked = response => {
  if(!response||response.schema!=='IWXA_PRESENTATION_BRIDGE/1.0.0'||
      typeof response.status!=='string'||response.openedWorkAutomatically!==false)
    throw Error('CEN05_NATIVE_RESPONSE_INVALID');
  return response;
};

const atlasSourceMessage={
  SOURCE_REVISION_CHANGED:'Редакция Atlas изменилась после открытия.',
  WORK_MISSING_IN_SOURCE:'Связанная работа больше не найдена в Atlas.',
  PROJECT_MISSING_IN_SOURCE:'Связанный проект больше не найден в Atlas.',
  ATLAS_SOURCE_SCHEMA_INVALID:'Не удалось подтвердить структуру данных Atlas.'
};
// A status describes observed native facts, not a claimed deep-link or
// authority. In particular LAUNCHED_NO_WINDOW is NOT WINDOW_OBSERVED.
export function describeCen05Status(operation,result){
  const status=result?.status;
  if(operation==='open'&&status==='WINDOW_OBSERVED')
    return 'Окно Atlas запущено. Работа внутри Atlas автоматически не выбирается.';
  if(operation==='open'&&status==='LAUNCHED_NO_WINDOW')
    return 'Atlas запущен, но окно пока не обнаружено. Когда оно появится, нажмите «Фокус Atlas». Работа автоматически не выбирается.';
  if(operation==='activate'&&status==='WINDOW_FOCUSED')
    return 'Окно Atlas получило фокус.';
  if(operation==='return'&&status==='CENTER_WINDOW_FOCUSED')
    return 'Возврат в Center: редакция Atlas перепроверена.';
  if(operation==='return'&&status==='WORK_SOURCE_NOT_CURRENT')
    return 'Возврат в Center выполнен. '+
      (atlasSourceMessage[result.reason]??'Актуальность источника Atlas не подтверждена.')+
      ' Прежняя ссылка поручения не изменена.';
  if(operation==='detach'&&status==='BINDING_CLOSED')
    return 'Связь с окном закрыта; Atlas продолжает работать.';
  return 'Подтверждение операции с Atlas отсутствует.';
}
const cen05ErrorMessage={
  WINDOW_NOT_FOUND:'Окно Atlas не найдено. Проверьте запуск программы и повторите фокусировку.',
  WINDOW_FOCUS_DENIED:'Windows не разрешила активировать окно Atlas. Повторите нажатие «Фокус Atlas».',
  PROCESS_EXITED:'Atlas завершил работу. Отсоедините прежнее окно и откройте Atlas снова.',
  SOURCE_REVISION_CHANGED:'План Atlas изменился. Перечитайте его в Center, не заменяя старую ссылку автоматически.',
  ATLAS_INSTALL_NOT_FOUND:'Установленный Atlas не найден. Проверьте установку канонического Atlas Desktop.',
  CEN05_BINDING_ALREADY_ACTIVE:'Сначала отсоедините предыдущую связь с окном Atlas.'
};
export function describeCen05Error(error){
  const code=error instanceof Error?error.message:String(error);
  return cen05ErrorMessage[code]??code;
}

export function createCen05NativePort(invoke) {
  if(typeof invoke!=='function')throw Error('CEN05_NATIVE_HOST_UNAVAILABLE');
  return Object.freeze({
    async open(ref) {
      if(!validWork(ref))throw Error('CEN05_WORK_REF_INVALID');
      return checked(await invoke('center_u04_open',ref));
    },
    async activate(ref) {
      if(!validWork(ref)||!valid(ref.bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_activate',ref));
    },
    async returnToCenter(ref) {
      if(!validWork(ref)||!valid(ref.bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_return',ref));
    },
    async detach({organizationId,bindingRef}) {
      if(!valid(organizationId)||!valid(bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_detach',{organizationId,bindingRef}));
    }
  });
}
