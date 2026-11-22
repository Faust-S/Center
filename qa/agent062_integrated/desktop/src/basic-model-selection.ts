/** UI-only projection of the one GGUF selection owned by Python Core.
 * Never infer model readiness, authority or permission from this form.
 */
export type GgufDraftFile={kind:'MODEL';selected:true;path:string;sha256:string;name:string};
export type SavedGgufDraft={identity:string;file:GgufDraftFile;license:string;source:string};
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const str=(value:unknown):string=>typeof value==='string'?value:'';
const digest=(value:unknown):string=>str(value).toLowerCase().replace(/^sha256:/,'');

export function savedGgufDraft(value:unknown):SavedGgufDraft|null{
 const snapshot=row(value),pin=row(snapshot.pin),model=row(snapshot.model);
 const path=str(snapshot.model_path),sha256=digest(pin.digest),name=str(pin.name)||str(model.name);
 if(!path||!name||!/^[a-f0-9]{64}$/.test(sha256))return null;
 return {
  identity:JSON.stringify([path,sha256]),
  file:{kind:'MODEL',selected:true,path,sha256,name},
  license:str(model.license),source:str(model.source),
 };
}

export function draftMatchesSavedGguf(value:unknown,file:unknown,license:string,source:string):boolean{
 const saved=savedGgufDraft(value),candidate=row(file);
 return !!saved&&str(candidate.path)===saved.file.path
  &&digest(candidate.sha256)===saved.file.sha256
  &&license===saved.license&&source===saved.source;
}

export function planGgufDraftHydration(value:unknown,previousCoreIdentity:string,draftPending:boolean):{
 identity:string;replaceDraft:boolean;saved:SavedGgufDraft|null
}{
 const saved=savedGgufDraft(value),identity=saved?.identity||'';
 return {identity,replaceDraft:!draftPending&&identity!==previousCoreIdentity,saved};
}
