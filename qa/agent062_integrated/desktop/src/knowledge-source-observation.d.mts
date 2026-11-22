export type KnowledgeSelection={path:string;expected_sha256:string;provider_id:string;binding_digest:string};
export type KnowledgeObservation={schema:string;providerId:string;sourceRef:string;revision:string;
 status:string;authority:string;bytes:number;provenance:Record<string,unknown>};
export type KnowledgeRead={source:Record<string,unknown>;observation:KnowledgeObservation;
 pin:{sourceRef:string;revision:string;authority:string}};
export function readKnowledgeSource(port:{query<T>(query:string,params:Record<string,unknown>):Promise<T>},
 selection:KnowledgeSelection,options?:{isCurrent?:()=>boolean;now?:()=>string}):Promise<KnowledgeRead>;
export function compareKnowledgeReads(previous:KnowledgeRead,next:KnowledgeRead):{
 status:'NOT_COMPARABLE'|'CHANGED'|'UNCHANGED';previousRevision?:string;currentRevision?:string};
