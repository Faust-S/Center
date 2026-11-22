export interface K01RevisionDraftInput {name:string;text:string;previousText?:string}
export interface K01RevisionDraft {
 readonly mode:'PAIRED_COMPARISON'|'NEW_ONLY';
 readonly text:string;
 readonly attachments:readonly {readonly name:string;readonly text:string}[];
}
export declare function prepareRevisionTaskDraft(
 file:K01RevisionDraftInput,language?:'ru'|'en'
):K01RevisionDraft;
