export type ProgramConnectFeedback = {
 state: 'READY' | 'NOT_CONNECTED' | 'UNCONFIRMED';
 ru: string;
 en: string;
};
/** Core snapshot identity for read-only persisted connection display. */
export type CurrentProgramConnection = {
 providerId:string;programId:string;connectionEpoch:string
};
export function currentProgramConnection(snapshot:unknown):CurrentProgramConnection|null;
export function programConnectFeedback(
 result: unknown,
 expectedProviderId: string,
 snapshot: unknown
): ProgramConnectFeedback;
