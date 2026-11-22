/** A successful U01 execution receipt is not proof of readable saved output. */
export type ProgramResultSummary={
 receipt_id:string;task_id:string;status:string;provider_id:string;
 external_effect_state:string;output_state:'VERIFIED'|'UNAVAILABLE'|'NOT_APPLICABLE';
 output_digest:string|null;
};
/** The exact saved output digest travels with Core's read-only history row.
 * Never offer a result as readable if that digest is unavailable. */
export function programResultReadable(row:Pick<ProgramResultSummary,'status'|'output_state'|'output_digest'>):boolean{
 return row.status==='SUCCEEDED'&&row.output_state==='VERIFIED'
  &&typeof row.output_digest==='string'&&/^[a-f0-9]{64}$/.test(row.output_digest);
}

/** Validate a persisted U01 result against the exact reviewed Task and Core
 * receipt. A receipt alone is not proof that its output is still readable. */
export function programResultMatchesTask(
 result:unknown,taskId:string,receiptId:string,outputDigest:string
):boolean{
 if(!result||typeof result!=='object'||Array.isArray(result)
  ||!taskId||!receiptId||!/^[0-9a-f]{64}$/.test(outputDigest))return false;
 const row=result as Record<string,unknown>;
 if(row.task_id!==taskId||row.receipt_id!==receiptId
  ||row.output_digest!==outputDigest||row.read_only!==true
  ||row.execution_performed!==false)return false;
 // Only the Core metadata-only response can assert successful readback
 // without carrying the full program output over the UI transport.
 // Both projections must explicitly confirm that Core re-read the saved
 // program output. An external execution receipt is not that confirmation.
 if(row.output_verified!==true)return false;
 if(row.metadata_only===true)return !('data' in row);
 if(row.metadata_only!==false)return false;
 const data=row.data;
 return !!data&&typeof data==='object'&&!Array.isArray(data)
  &&typeof (data as Record<string,unknown>).output==='string';
}
