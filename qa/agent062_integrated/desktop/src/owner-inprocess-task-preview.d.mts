export interface CoreTaskModelPreview {
  readonly schema:'PA.K02_K04.CORE_TASK_PREVIEW/0.1.0';
  readonly taskId:string;
  readonly acceptedTaskResultDigest:string;
  readonly skillId:string;
  readonly providerId:string;
  readonly modelPin:{readonly name:string;readonly digest:string};
  readonly bindingDigest:string;
  readonly k02PlanDigest:string;
  readonly k04PlanDigest:string;
  readonly compatible:true;
  readonly kind:'SINGLE_SELECTED_LOCAL_MODEL';
  readonly modelSelectionOrigin:'CURRENT_ACTIVE_MODEL'|'EXPLICIT_STEP_PIN';
  readonly sourceCoverage:'TASK_OBJECTIVE_ONLY';
  readonly taskModelMatch:boolean|null;
  readonly modelQualityAssessed:false;
  readonly taskOutcomeAssessed:false;
  readonly executionPerformed:false;
  readonly verifiedByCore:false;
  readonly ownerReceipts:null;
}
/** Read-only Core-observed compatibility hypothesis; no Task/Graph mutation. */
export declare function previewCoreTaskModel(args:{
  task:unknown;skills:unknown;modelBinding:unknown;
  observation:unknown;
  selectedModelPin?:{name:string;digest:string}|null;
}):CoreTaskModelPreview;

/** Graph preview-only evidence; no attested owner receipts or authority. */
export declare function graphEvidenceForCoreTaskModelPreview(
  preview:CoreTaskModelPreview,
  facts:{
    taskId:string;
    acceptedTaskResultDigest:string;
    skillId:string;
    providerId:string;
    bindingDigest:string;
    modelPin:{name:string;digest:string};
  },
):{
  evidence_refs:string[];
  uncertainties:['K02_K04_PREVIEW_ONLY_NOT_OWNER_ATTESTED'];
};
