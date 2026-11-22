export type K03SourceExcerpt={
 text:string;sourceId:string;sourceRevision:string;sourceSha256:string;
 evidenceId:string;locator:{byte_start:number;byte_end:number};
};
export declare function k03SourceExcerpt(
 hypothesis:unknown, observations:unknown, sources:unknown,
):K03SourceExcerpt|null;
