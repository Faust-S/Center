import type {DocumentChangePreview} from './k01-attachment-comparison.mjs';
export interface AcceptedProjectRefresh {
 readonly authority:'REVIEW_ONLY';
 readonly status:'CURRENT'|'UPDATED'|'INCOMPLETE'|'REJECTED';
 readonly reason:string|null;
 readonly requiresReview:boolean;
 readonly reusable:boolean;
 readonly complete:boolean;
 readonly oldTaskId:string;
 readonly newTaskId:string;
 readonly workspaceRef:string;
 readonly scopeRevision:string;
 readonly sourceBytes:readonly [number,number];
 readonly comparedFieldCount:number;
 readonly fieldLabels:readonly {fieldKey:string;label:string}[];
 readonly fieldChanges:readonly {fieldKey:string;kinds:readonly string[];previous:unknown;current:unknown}[];
 readonly sourceChanges:readonly {sourceRef:string;kind:string;previousRevision:string|null;currentRevision:string|null}[];
 readonly issueChanges:{appeared:readonly {fieldKey:string;type:string;sources:readonly string[]}[];
  resolved:readonly {fieldKey:string;type:string;sources:readonly string[]}[]};
 readonly sourceRevisions:readonly {sourceRef:string;revision:string}[];
 readonly visual:DocumentChangePreview;
}
export declare function reviewAcceptedResultChange(
 port:{query(name:string,params?:Record<string,unknown>):Promise<unknown>},
 request:{olderTaskId:string;newerTaskId:string;maxTokens?:number;isCurrent?:()=>boolean}
):Promise<AcceptedProjectRefresh>;

export interface AcceptedComparisonDraftInput {
 readonly authority:'DRAFT_INPUT_ONLY';
 readonly name:string;
 readonly text:string;
 readonly previousText:string;
 readonly sourcePath:string;
}
export declare function prepareAcceptedResultComparisonDraft(
 port:{query(name:string,params?:Record<string,unknown>):Promise<unknown>},
 comparison:AcceptedProjectRefresh,
 options?:{isCurrent?:()=>boolean}
):Promise<AcceptedComparisonDraftInput>;
