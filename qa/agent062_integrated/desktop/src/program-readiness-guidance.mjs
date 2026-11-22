/**
 * Human-readable explanations for U03 observations in the existing U01
 * Programs surface. Observation only: no retries, connections or authority.
 */
export function programReadinessMessage(reason, sourceStatus, sourceConnected) {
  if (reason == null || reason === '' ||
      reason === 'operation-unverified' ||
      reason === 'execution-receipt-missing') return null;
  if (reason === 'source-unavailable') {
    if (sourceStatus === 'DECLARED' && sourceConnected === true) {
      return {
        ru: 'Подключение программы изменилось. Обновите список программ и проверьте подключение перед подготовкой задачи.',
        en: 'Program connection state has changed. Refresh programs and verify the connection before preparing a Task.',
      };
    }
    return {
      ru: 'Программа обнаружена, но ещё не подключена. Нажмите «Подключить и проверить». Если подключение не удаётся, проверьте путь и версию программы.',
      en: 'The program was detected but is not connected. Select “Connect and verify”. If it still fails, check the executable path and version.',
    };
  }
  if (reason === 'connection-unscoped') return {
    ru: 'Подключение устарело. Подключите программу повторно перед созданием задачи.',
    en: 'The connection is no longer current. Connect and verify the program again before creating a Task.',
  };
  if (reason === 'operation-unsupported') return {
    ru: 'Эта операция не поддерживается подключённой программой. Выберите другое действие.',
    en: 'The connected program does not support this operation. Select another action.',
  };
  return {
    ru: 'Действие пока недоступно. Проверьте подключение программы и обновите список; выполнение не запускалось.',
    en: 'This action is unavailable. Check the program connection and refresh the list; no operation has been run.',
  };
}
