/** Fixed UI advice for a known Core rejection. Never changes a setting. */
export type WorkModeRecovery={code:string;ru:string;en:string};
export function workModeRecovery(error:unknown):WorkModeRecovery|null{
 const text=error instanceof Error?error.message:typeof error==='string'?error:'';
 if(!/(?:^|[\s:])t3_external_execution_disabled(?:$|[\s:])/i.test(text))return null;
 return {
  code:'t3_external_execution_disabled',
  ru:'Локальный режим запрещает сетевую загрузку и другие внешние операции. В разделе «Модели» подключите уже установленный движок и GGUF-модель либо явно разрешите внешние операции в настройках режима работы и повторите действие. Настройки не изменены автоматически.',
  en:'Local mode blocks network downloads and other external operations. In Models, connect an existing runtime and GGUF model, or explicitly allow external operations in work-mode settings, then retry. No setting was changed automatically.'
 };
}
