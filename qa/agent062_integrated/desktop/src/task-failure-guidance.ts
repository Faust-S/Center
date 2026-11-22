/** Explain recorded Core terminal states without model grading or auto retry. */
export function taskFailureGuidance(code:string,tr:(ru:string,en:string)=>string):string{
 switch(code){
  case 'basic_runtime_busy':return tr(
   'Локальная модель была занята. Проверьте эту задачу и состояние движка на странице «Модели» перед новым запросом.',
   'The local model was busy. Inspect this Task and the engine on Models before another request.');
  case 'basic_runtime_timeout':return tr(
   'Выполнение превысило лимит времени. Локальная модель могла долго загружаться или рассуждать. Проверьте сохранённую задачу; для нового запроса можно выбрать другую глубину рассуждений.',
   'Execution exceeded the time limit. A local model may have been loading or reasoning for a long time. Inspect the saved Task; for a new request you may choose another reasoning depth.');
  case 'basic_runtime_output_invalid':return tr(
   'Полный ответ модели не подтверждён. Проверьте сохранённую задачу и параметры модели; это не оценка качества её ответа.',
   'A complete model response was not confirmed. Inspect the saved Task and model settings; this is not a quality grade of its answer.');
  case 'basic_runtime_output_frame_invalid':return tr(
   'Запись ответа локальной модели не совпала с исходным запросом. Ответ не принят. Проверьте задачу и движок в разделе «Модели» перед новой отправкой.',
   'The local model transcript did not match the original request. No answer was accepted. Inspect the saved Task and engine in Models before submitting again.');
  case 'basic_runtime_output_reasoning_invalid':return tr(
   'Модель вернула несогласованные границы рассуждений. Не используйте этот вывод как результат; проверьте выбранную модель и её настройки.',
   'The model returned inconsistent reasoning boundaries. This output was not accepted as a Result; inspect the selected model and its settings.');
  case 'basic_runtime_output_reasoning_unfinished':return tr(
   'Модель не завершила рассуждение и не сформировала проверенный ответ. Задача сохранена; для нового запроса можно выбрать другую глубину рассуждений.',
   'The model did not finish its reasoning or produce a verified answer. The Task remains saved; for a new request you may choose another reasoning depth.');
  case 'basic_runtime_output_empty':return tr(
   'После выполнения локальной модели не получен видимый ответ. Задача сохранена; проверьте состояние движка и параметры новой отправки.',
   'No visible answer was returned by the local model. The Task remains saved; inspect the engine and settings before another submission.');
  case 'basic_runtime_generation_failed':
  case 'basic_runtime_start_failed':return tr(
   'Процесс локальной модели не завершил запрос. Проверьте движок на странице «Модели» и сохранённую задачу перед новой отправкой.',
   'The local model process did not complete. Inspect the engine on Models and the saved Task before submitting again.');
  case 'basic_runtime_model_not_active':return tr(
   'Выбранная локальная модель больше не активна. Откройте «Модели» и проверьте доступность. Сохранённая задача остаётся в Core.',
   'The selected local model is no longer active. Open Models to check availability. The saved Task remains in Core.');
  case 'basic_runtime_model_pin_changed':
  case 'basic_runtime_model_digest_changed':
  case 'basic_runtime_component_changed':return tr(
   'Файл модели или движок изменился. Проверьте выбранную модель перед новой отправкой; прежнюю задачу нельзя автоматически повторять.',
   'The model file or engine changed. Verify the selected model before another submission; the previous Task must not be replayed automatically.');
  case 'interactive_task_result_readback_unverified':return tr(
   'Обработка завершилась, но Core не подтвердил Result. Откройте сохранённую задачу и историю выполнения. Проверка не требует повторного запуска модели.',
   'Processing ended, but Core has not verified a saved Result. Open the saved Task and execution history. Inspection does not require rerunning the model.');
  default:return tr(
   'Core сохранил причину остановки. Откройте задачу и историю выполнения. Не отправляйте ту же работу повторно, пока её результат не выяснен.',
   'Core recorded the interruption reason. Inspect the saved Task and execution history. Do not resubmit the same work until its outcome is clear.');
 }
}
