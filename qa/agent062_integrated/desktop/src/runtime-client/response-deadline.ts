/** Bound response waiting, including the body. Never retry or attest effects. */
export class ResponseReadFailure extends Error {
 constructor(readonly phase:'network'|'body'|'deadline',readonly status:number){
  super('runtime_response_'+phase);this.name='ResponseReadFailure';
 }
}
export async function receiveRuntimeResponse(
 url:string,init:RequestInit,deadlineMs:number,
):Promise<{response:Response;parsed:unknown}>{
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<0||deadlineMs>120000)
  throw new TypeError('invalid_response_deadline');
 const controller=deadlineMs>0?new AbortController():null;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let status=0;
 const work=(async()=>{
  let response:Response;
  try{response=await fetch(url,{...init,...(controller?{signal:controller.signal}:{})});}
  catch{throw new ResponseReadFailure('network',0);}
  status=response.status;
  // Session recovery requires no response payload; a broken error body must
  // not prevent the existing authenticated recovery route.
  if(status===401)return {response,parsed:undefined};
  try{return {response,parsed:await response.json()};}
  catch{throw new ResponseReadFailure('body',status);}
 })();
 if(!controller)return work;
 const expiry=new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>{
   // Reject the UI wait first; abort only the response stream. Server-side
   // execution may continue, so a mutation remains UNKNOWN, never CANCELLED.
   reject(new ResponseReadFailure('deadline',status));
   controller.abort();
  },deadlineMs);
 });
 try{return await Promise.race([work,expiry]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
