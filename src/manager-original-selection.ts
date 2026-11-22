// A navigation pointer only. It never grants access or records ACCEPT/Apply.
export type ManagerOriginalSelection={
  kind:'signed-task'|'signed-result-package';id:string;
  organizationId:string;workspaceId:string;
  actorId:string;contextId:string;contextEpoch:number;
};
