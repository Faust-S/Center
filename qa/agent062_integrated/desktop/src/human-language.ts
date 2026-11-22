/* IWXA communication/PRODUCT_UI: wording only; never feed translated states back to Core. */
export type UiLang='ru'|'en';

const states:Record<string,[string,string]>={
 COMPLETED:['Завершено','Completed'],PROCESSING:['Выполняется','Running'],
 PENDING_REVIEW:['Ожидает проверки','Awaiting review'],PENDING:['Ожидает выполнения','Pending'],
 SCHEDULED:['Запланировано','Scheduled'],PAUSED:['Приостановлено','Paused'],
 RUNNING:['Выполняется','Running'],DONE:['Завершено','Completed'],
 TODO:['Ожидает выполнения','Not started'],VERIFY:['Ожидает проверки','Awaiting review'],
 BLOCKED:['Требуется вмешательство','Needs attention'],DEAD:['Остановлено после ошибок','Stopped after failures'],
 SUCCEEDED:['Выполнено','Succeeded'],FAILED:['Не выполнено','Failed'],
 NOT_STARTED:['Ещё не выполнялось','Not started'],STARTED:['Начато, результат пока не подтверждён','Started, result not yet confirmed'],
 APPROVED:['Разрешено','Approved'],REJECTED:['Отклонено','Rejected'],
 PASS:['Критерий выполнен','Criterion met'],FAIL:['Критерий не выполнен','Criterion not met'],
 UNKNOWN:['Не удалось установить','Unknown'],
 OUTCOME_UNKNOWN:['Результат неизвестен','Outcome unknown'],INTERRUPTED:['Прервано','Interrupted'],
 OPEN_UNKNOWN:['Результат требует проверки','Outcome needs checking'],
 EVIDENCE_PENDING:['Ожидаются основания','Evidence pending'],
 REMAINS_UNKNOWN:['Результат пока неизвестен','Outcome still unknown'],
 RESOLVED_NOT_APPLIED:['Проверено: действие не выполнялось','Verified: action was not applied'],
 RESOLVED_APPLIED:['Проверено: действие выполнено','Verified: action was applied'],
 RETRY_ALLOWED:['Повтор можно подготовить','A retry may be prepared'],
 PREVIEW_ONLY:['Предложение готово к проверке','Proposal ready for review'],
 VALIDATED_AWAITING_HUMAN_REVIEW:['Ожидает решения','Awaiting decision'],
 INSTALLED_DETECTED:['Установка обнаружена. Готовность ещё нужно проверить','Installation detected. Readiness needs checking'],
 RECHECKED_INSTALLED:['Программа найдена. Её ещё нужно подключить','Program found. It still needs connecting'],
 RECHECKED_NOT_DETECTED:['Программа не обнаружена','Program not detected'],
 INSTALLER_FAILED_RECHECK_REQUIRED:['Установка завершилась с ошибкой. Проверьте состояние','Installer failed. Check current state'],
 RECHECK_REQUIRED:['Нужна повторная проверка','Needs another check'],
 TIMEOUT_OUTCOME_UNKNOWN:['Установка не завершилась вовремя. Результат неизвестен','Installation timed out. Outcome unknown'],
 INSTALL_INTERRUPTED_OUTCOME_UNKNOWN:['После прерывания исход установки неизвестен','Installation outcome unknown after interruption'],
 UPGRADE_INTERRUPTED_OUTCOME_UNKNOWN:['Исход обновления неизвестен. Повтор заблокирован','Upgrade outcome unknown. Retry is blocked'],
 UPGRADE_RECHECK_INCONCLUSIVE:['Совместимость после обновления не подтверждена','Compatibility could not be verified after upgrading'],
 LAUNCH_FAILED_RECHECK_REQUIRED:['Не удалось запустить установку','Could not start installation'],
 RECONCILIATION_REQUIRED:['Требуется проверка предыдущего действия','Previous action needs reconciliation'],
 EXTERNAL_EFFECT_UNKNOWN_REQUIRES_RECONCILIATION:['Результат предыдущего действия неизвестен','Previous action outcome unknown'],
};
export function humanState(code:unknown,lang:UiLang='ru'):string{
 const value=typeof code==='string'?code.trim():'';
 if(!value)return lang==='ru'?'Пока неизвестно':'Not yet known';
 const item=states[value.toUpperCase()];
 return item?item[lang==='ru'?0:1]:(lang==='ru'?'Состояние требует уточнения':'State needs checking');
}
export function taskSourceName(source:unknown,lang:UiLang='ru'):string{
 const text=typeof source==='string'?source:'';
 const names:Record<string,[string,string]>={
 'OLLAMA_LOCAL_V1':['Локальная Ollama','Local Ollama'],
 'IWXA_BASIC_RUNTIME_V1':['IWXA LLM Engine','IWXA LLM Engine'],
 'LOCAL_FILES_V1':['Личные файлы','Personal files'],
 'OBSIDIAN_V1':['Obsidian','Obsidian'],
 'NONE':['Модель пока не выбрана','No model selected']
 };
 return names[text]?.[lang==='ru'?0:1]|| (text&&text!=='NONE' ? (lang==='ru'?'Другая модель':'Another model') : (lang==='ru'?'Модель пока не выбрана':'No model selected'));
}
