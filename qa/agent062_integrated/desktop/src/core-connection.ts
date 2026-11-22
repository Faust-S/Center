/** Only verified Core reads justify a connected user-facing status. */
export type CoreConnectionState='checking'|'ready'|'partial'|'unavailable';
export type CoreProbeState='fulfilled'|'rejected';
export function observedCoreConnection(statusRead:CoreProbeState,workspaceRead:CoreProbeState):CoreConnectionState{
 if(statusRead==='fulfilled'&&workspaceRead==='fulfilled')return 'ready';
 if(statusRead==='fulfilled'||workspaceRead==='fulfilled')return 'partial';
 return 'unavailable';
}
export function coreConnectionLabel(state:CoreConnectionState,language:'ru'|'en'):string{
 const labels={
  checking:['Проверяем соединение с ядром','Checking local Core'],
  ready:['Ядро подключено','Core connected'],
  partial:['Ядро отвечает, готовность не подтверждена','Core responding; readiness unverified'],
  unavailable:['Нет связи с ядром','Core unavailable']
 } as const;
 return labels[state][language==='ru'?0:1];
}
