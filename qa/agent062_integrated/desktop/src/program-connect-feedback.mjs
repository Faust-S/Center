/** Read-only interpretation of one explicit U01 connection attempt and Core readback. */
const hint = (state, ru, en) => ({state, ru, en});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

/** Persisted connection readback from Core, not a new permission or action. */
export function currentProgramConnection(snapshot) {
  if (!isObject(snapshot) || typeof snapshot.active_provider_id !== 'string' ||
      !snapshot.active_provider_id || !Array.isArray(snapshot.programs) ||
      !isObject(snapshot.selected) || typeof snapshot.selected.program_id !== 'string' ||
      !snapshot.selected.program_id || !isObject(snapshot.selected.source) ||
      snapshot.selected.source.schema !== 'IWXA_PROGRAM_CONNECTION/1.0.0' ||
      snapshot.selected.source.program_id !== snapshot.selected.program_id ||
      snapshot.selected.source.transport !== 'cli' ||
      snapshot.selected.source.status !== 'DECLARED' ||
      snapshot.selected.source.connected !== true ||
      !epoch(snapshot.selected.source.connection_epoch)) return null;
  const providerId = snapshot.active_provider_id;
  const programId = snapshot.selected.program_id;
  if (!snapshot.programs.some(row => isObject(row) &&
      row.provider_id === providerId && row.program_id === programId &&
      row.selected === true)) return null;
  return {providerId, programId, connectionEpoch: snapshot.selected.source.connection_epoch};
}

export function programConnectFeedback(result, expectedProviderId, snapshot) {
  if (!isObject(result) || result.schema !== 'IWXA_PROGRAM_CONNECTION/1.0.0' ||
      result.transport !== 'cli' || typeof result.program_id !== 'string' || !result.program_id ||
      typeof expectedProviderId !== 'string' || !expectedProviderId) {
    return hint('UNCONFIRMED',
      'Ответ подключения не подтверждён. Обновите сведения о программе перед новой попыткой.',
      'The connection response is not confirmed. Refresh the program status before trying again.');
  }
  if (result.status !== 'CONNECTED' || result.connected !== true) {
    switch(result.status) {
      case 'NOT_FOUND': return hint('NOT_CONNECTED',
        'Программа не найдена. Проверьте её установку и путь к исполняемому файлу.',
        'The program was not found. Check its installation and executable path.');
      case 'INSTALLATION_MISMATCH': return hint('NOT_CONNECTED',
        'Исполняемый файл изменился или не совпал с закреплённой версией. Проверьте программу и подключите её заново.',
        'The executable has changed or failed its pinned identity check. Verify the program before reconnecting.');
      case 'VERSION_UNVERIFIED': return hint('NOT_CONNECTED',
        'Не удалось подтвердить версию программы. Проверьте параметры проверки версии и установленный файл.',
        'The program version could not be verified. Check the version command and installed executable.');
      case 'PROCESS_NOT_RUNNING': return hint('NOT_CONNECTED',
        'Программа сейчас не запущена. Запустите её и повторите подключение вручную.',
        'The program is not running. Start it and reconnect manually.');
      case 'CLI_TIMED_OUT': return hint('NOT_CONNECTED',
        'Программа не ответила на проверку версии. Проверьте её запуск перед повторной попыткой.',
        'The program did not answer the version check. Check its startup before retrying.');
      default: return hint('NOT_CONNECTED',
        'Подключение не подтверждено (' + String(result.status || 'UNKNOWN') + '). Проверьте программу и обновите список.',
        'Connection not confirmed (' + String(result.status || 'UNKNOWN') + '). Check the program and refresh the list.');
    }
  }
  const current = currentProgramConnection(snapshot);
  if (!epoch(result.connection_epoch) || current?.providerId !== expectedProviderId ||
      current.programId !== result.program_id ||
      current.connectionEpoch !== result.connection_epoch) {
    return hint('UNCONFIRMED',
      'Проверка версии выполнена, но актуальное подключение не подтверждено Core. Обновите список без повторного запуска действия.',
      'The version check completed, but Core did not confirm the current connection. Refresh the list without rerunning an action.');
  }
  if (!Array.isArray(snapshot.selected.operations) ||
      !snapshot.selected.operations.some(row => isObject(row) && row.can_offer_invocation === true)) {
    return hint('UNCONFIRMED',
      'Программа подключена, но доступных действий пока нет. Проверьте объявленные операции.',
      'The program is connected, but no actions are available. Check its declared operations.');
  }
  return hint('READY',
    'Программа подключена. Подготовьте задачу и подтвердите выполнение отдельно.',
    'Program connected. Prepare a Task and approve execution separately.');
}
