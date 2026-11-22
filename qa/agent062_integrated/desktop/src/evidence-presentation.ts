/** Display-only projection. Never grants permission or changes a Core receipt. */
export type DisplayValue = null | boolean | number | string | DisplayValue[] | {[key:string]:DisplayValue};
export type EvidencePresentation = {value:DisplayValue; redacted:number; limited:boolean};
const REDACTED='[REDACTED]';
const OMITTED='[NOT DISPLAYED: PRESENTATION LIMIT]';
const keyOf=(key:string)=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
function isSecretKey(key:string):boolean{
 const k=keyOf(key);
 return /password|passwd|passphrase|secret|credential|privatekey|authorization|cookie/.test(k)
  || /^(token|key|apikey|accesskey|bearer|headers|environment|env|environ)$/.test(k)
  || /(?:access|refresh|session|bootstrap|claim|auth|bearer|login|csrf|xsrf|id)token/.test(k);
}
/** Best-effort scrubbing of familiar credential forms, not a claim to detect
 * every secret someone may have placed in arbitrary text. Local display only. */
function scrubText(text:string,redact:()=>string):string{
 return text
  .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,redact)
  .replace(/\bBearer\s+[^\s"'<>]+/gi,()=>`Bearer ${redact()}`)
  .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,redact)
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g,redact)
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,(_all,scheme:string)=>scheme+redact()+'@')
  .replace(/([?&#](?:token|key|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|iwxa_bootstrap|code|client[_-]?secret)=)[^&#\s"'<>]*/gi,(_all,prefix:string)=>prefix+redact())
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|bootstrap[_-]?token|claim[_-]?token|client[_-]?secret|password|authorization|cookie|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,(_all,prefix:string)=>prefix+redact())
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
}
export function presentEvidence(input:unknown):EvidencePresentation{
 let redacted=0,limited=false,nodes=0;
 const seen=new WeakSet<object>();
 const redact=()=>{redacted++;return REDACTED;};
 const limit=()=>{limited=true;return OMITTED;};
 const inaccessible=()=>{limited=true;return '[NOT DISPLAYED: ACCESSOR]';};
 function visit(value:unknown,depth:number):DisplayValue{
  if(++nodes>1200||depth>10)return limit();
  if(value===null)return null;
  if(value===undefined){limited=true;return '[NOT PROVIDED]';}
  if(typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))limited=true;return Number.isFinite(value)?value:String(value);}
  if(typeof value==='string'){
   const safe=scrubText(value,redact);
   return safe.length<=24000?safe:safe.slice(0,24000)+'\n'+limit();
  }
  if(typeof value!=='object'){limited=true;return '[UNSUPPORTED VALUE]';}
  if(seen.has(value))return limit();
  seen.add(value);
  try{
   if(value instanceof Error)return {name:scrubText(value.name,redact),message:visit(value.message,depth+1)};
   if(Array.isArray(value)){
    const result:DisplayValue[]=[];
    for(const item of value.slice(0,200)){
     if(nodes>=1200){result.push(limit());break;}
     result.push(visit(item,depth+1));
    }
    if(value.length>200)result.push(limit());
    return result;
   }
   const result:Record<string,DisplayValue>=Object.create(null);
   const keys=Object.keys(value);
   for(const key of keys.slice(0,200)){
    if(nodes>=1200){result['[MORE FIELDS]']=limit();break;}
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    // A presentation helper must not execute getters supplied by an object.
    result[key]=isSecretKey(key)?redact():descriptor&&'value' in descriptor
     ?visit(descriptor.value,depth+1):inaccessible();
   }
   if(keys.length>200)result['[MORE FIELDS]']=limit();
   return result;
  }finally{seen.delete(value);}
 }
 return {value:visit(input,0),redacted,limited};
}
export function evidenceText(value:DisplayValue):string{
 if(typeof value==='string')return value;
 return JSON.stringify(value,null,2);
}

/** An exact consequential decision cannot rest on redacted or truncated evidence. */
export function isCompleteDecisionEvidence(evidence:EvidencePresentation|null):boolean{
 return evidence!==null&&!evidence.limited&&evidence.redacted===0;
}
