/** Presentation-only classification of Core-confirmed program availability.
 * A working local service or connected vault need not expose a discoverable EXE.
 * Does not grant permission or start a program. */
export type ProgramAvailability='READY'|'NEEDS_CHECK'|'NOT_CONNECTED';

export function programAvailability(
  installedInWindows:boolean,
  stagedByIwxa:boolean,
  executionVerified:boolean,
):ProgramAvailability{
  if(executionVerified)return 'READY';
  return installedInWindows||stagedByIwxa?'NEEDS_CHECK':'NOT_CONNECTED';
}

/** Network installs/updates require confirmed T3 OFF. Core checks again at use. */
export function networkActionAvailable(t3Enabled:boolean|null):boolean{
  return t3Enabled===false;
}

/** UI projection of independent Core facts, never an executable-presence guess. */
export type ProgramWorkState='NOT_DETECTED'|'DETECTED'|'CONNECTED'|'READY_FOR_TASK'|'EXECUTED'|'EXECUTION_FAILED';
export function programWorkState(facts:{
 detected:boolean;connected:boolean;ready:boolean;executed:boolean;executionFailed?:boolean
}):ProgramWorkState{
 if(facts.executionFailed===true)return 'EXECUTION_FAILED';
 if(facts.executed===true)return 'EXECUTED';
 if(facts.ready===true)return 'READY_FOR_TASK';
 if(facts.connected===true)return 'CONNECTED';
 return facts.detected===true?'DETECTED':'NOT_DETECTED';
}
