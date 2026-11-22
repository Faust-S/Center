export type SavedProgramOutput={
 workspace_id:string;task_id:string;receipt_id:string;output_digest:string;
 execution_performed:false;read_only:true;data:{output:string}
};
export type ProgramOutputObservation={
 pin:{sourceRef:string;revision:string;authority:string};
 observation:{schema:string;sourceRef:string;revision:string;contentRef:string;
  status:string;authority:string;bytes:number;content:null;
  provenance:Record<string,unknown>}
};
export function observeSavedProgramOutput(result:SavedProgramOutput,
 now?:()=>string):Promise<ProgramOutputObservation>;
