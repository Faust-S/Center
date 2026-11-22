/** Read-only guidance; never a Core capability, approval or connection. */
export type ProgramReadinessMessage = { ru: string; en: string };
export function programReadinessMessage(
 reason: string | null | undefined,
 sourceStatus: string | undefined,
 sourceConnected: boolean | undefined
): ProgramReadinessMessage | null;
