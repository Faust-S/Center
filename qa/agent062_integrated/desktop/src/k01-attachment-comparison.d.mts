export interface DocumentVisualChange {
 readonly label:string;
 readonly kind:'ADDED'|'REMOVED'|'CHANGED';
 readonly before:string|null;
 readonly after:string|null;
 readonly beforeLine:number|null;
 readonly afterLine:number|null;
}
export interface DocumentChangePreview {
 readonly contentChanged:boolean;
 readonly structuredChanges:readonly DocumentVisualChange[];
 readonly totalStructuredChanges:number;
 readonly hiddenStructuredChanges:number;
 readonly ambiguousLabels:readonly string[];
 readonly ambiguousCount:number;
 readonly lineSample:{
  readonly beforeStart:number;readonly afterStart:number;
  readonly before:readonly string[];readonly after:readonly string[];
  readonly beforeOmitted:number;readonly afterOmitted:number;
 }|null;
}
export interface VerifiedTaskDocumentPreview {
 readonly authority:'PREVIEW_ONLY';
 readonly oldSha256:string;
 readonly oldFile:{readonly text:string;readonly bytes:number};
 readonly newFile:{readonly name:string;readonly sha256:string;readonly bytes:number;readonly text:string};
 readonly comparison:DocumentChangePreview;
}
export declare function compareTaskAttachmentWithFile(
 port:{query(name:string,params:Record<string,string>):Promise<unknown>},
 identity:{taskId:string;snapshotId:string;path:string;sha256:string},
 file:File,
 options?:{isCurrent?:()=>boolean}
):Promise<VerifiedTaskDocumentPreview>;
