import type {U04Observation,VerifiedWindow} from './native-program-observation';

// An adapter for the existing U04 owner bridge. Only the native OS host
// observes and focuses a pre-existing, approved application. No launch port.
const APP='external:obsidian';
const SCHEMA='IWXA_PRESENTATION_BRIDGE/1.0.0';
const validStamp=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&
 v.length<=256&&!/[\u0000-\u001f\u007f]/.test(v);
const validPid=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const validRef=(v:unknown):v is string=>validStamp(v);

type NativeResponse={status?:unknown;pid?:unknown;processStamp?:unknown;windowRef?:unknown;
 verified?:unknown;observed?:unknown;focused?:unknown};
type NativeInvoke=(command:string,params:Record<string,unknown>)=>Promise<NativeResponse>;
type OwnerBridge={
 reattach:(args:{appRef:string;hostRef:string;pid:number;processStamp:string})=>Promise<U04Observation>;
 activate:(args:{bindingRef:string;hostRef:string})=>Promise<U04Observation>;
 closeBinding:(args:{bindingRef:string;hostRef:string})=>Promise<U04Observation>;
};
type OwnerFactory=(adapter:Record<string,unknown>)=>OwnerBridge;

export function createNativeU04Controller(hostRef:string,nativeInvoke:NativeInvoke,ownerFactory:OwnerFactory){
 if(!validRef(hostRef)||typeof nativeInvoke!=='function'||typeof ownerFactory!=='function')
  throw Error('U04_HOST_INVALID');
 let disposed=false;
 let active:{pid:number;processStamp:string;bindingRef:string}|null=null;
 let inFlight:Promise<U04Observation>|null=null;
 let requestedWindowRef:string|null=null;
 // Serialize explicit inspect, focus and detach in this U04 owner session.
 // An inspection must not close a binding during a pending native focus.
 let pendingWork:Promise<unknown>=Promise.resolve();
 const serialize=<T,>(action:()=>Promise<T>):Promise<T>=>{
  const result=pendingWork.then(action);
  pendingWork=result.then(()=>undefined,()=>undefined);
  return result;
 };
 const native=async(command:string,params:Record<string,unknown>):Promise<NativeResponse>=>{
  try{return await nativeInvoke(command,params);}catch{return {status:'NATIVE_HOST_UNAVAILABLE'};}
 };
 const nativeIdentity=async({pid,processStamp}:{pid:number;processStamp:string})=>{
  if(disposed||!active||active.pid!==pid||active.processStamp!==processStamp)
   return {verified:false};
  const proof=await native('u04_verify_existing_process',{appRef:APP,processId:pid,processStamp});
  return {verified:proof.verified===true};
 };
 const adapter={linkedWindow:true,launchAvailable:false,focusAvailable:true,
  reattachAvailable:true,
  async launch(){return {status:'HOST_APPROVAL_REQUIRED'};},
  async reattach({appRef,hostRef:requestedHost,pid,processStamp}:{appRef:string;hostRef:string;pid:number;processStamp:string}){
   if(disposed||appRef!==APP||requestedHost!==hostRef||!validPid(pid)||!validStamp(processStamp))
    return {status:'REATTACH_UNSUPPORTED'};
   const proof=await native('u04_verify_existing_process',{appRef:APP,processId:pid,processStamp});
   if(proof.verified!==true)return {status:'PROCESS_IDENTITY_CHANGED'};
   if(disposed)return {status:'REATTACH_UNSUPPORTED'};
   active={pid,processStamp,bindingRef:''};
   return {status:'REATTACHED',pid,processStamp,spawned:false};
  },
  verifyProcessIdentity:nativeIdentity,
  async observe({pid,appRef,processStamp}:{pid:number;appRef:string;processStamp?:string|null}){
   if(disposed||!active||appRef!==APP||pid!==active.pid||
      (processStamp!==undefined&&processStamp!==null&&processStamp!==active.processStamp))
    return {observed:false};
   const result=await native('u04_observe_existing_window',{
    appRef:APP,processId:pid,processStamp:active.processStamp});
   return {observed:result.observed===true&&validRef(result.windowRef),
    windowRef:validRef(result.windowRef)?result.windowRef:null};
  },
  async focus({pid,windowRef}:{pid:number;windowRef:string}){
   if(disposed||!active||pid!==active.pid||!validRef(windowRef)||
      windowRef!==requestedWindowRef)return {focused:false};
   const result=await native('u04_focus_existing_window',{
    appRef:APP,processId:pid,processStamp:active.processStamp,windowRef});
   return {focused:result.focused===true};
  }
 };
 const bridge=ownerFactory(adapter);
 async function performInspect():Promise<U04Observation>{
  if(disposed)return {schema:SCHEMA,status:'BINDING_CLOSED'};
  if(active?.bindingRef)await bridge.closeBinding({bindingRef:active.bindingRef,hostRef});
  active=null;
  const found=await native('u04_find_existing_window',{appRef:APP});
  if(disposed)return {schema:SCHEMA,status:'BINDING_CLOSED'};
  if(found.status==='NATIVE_HOST_UNAVAILABLE'||found.status==='PLATFORM_UNSUPPORTED')
   return {schema:SCHEMA,status:'WINDOW_OBSERVATION_FAILED'};
  if(found.status!=='WINDOW_OBSERVED'||!validPid(found.pid)||!validStamp(found.processStamp)||
      !validRef(found.windowRef))return {schema:SCHEMA,status:'WINDOW_NOT_FOUND'};
  const receipt=await bridge.reattach({appRef:APP,hostRef,pid:found.pid,processStamp:found.processStamp});
  if(disposed){
   active=null;
   if(validRef(receipt.binding?.bindingRef))
    await bridge.closeBinding({bindingRef:receipt.binding.bindingRef as string,hostRef});
   return {schema:SCHEMA,status:'BINDING_CLOSED'};
  }
  if(receipt.status==='WINDOW_OBSERVED'&&receipt.binding?.processId===found.pid&&
      receipt.binding?.processStamp===found.processStamp&&
      receipt.binding?.windowRef===found.windowRef&&validRef(receipt.binding?.bindingRef)){
   active={pid:found.pid,processStamp:found.processStamp,
    bindingRef:receipt.binding.bindingRef as string};
   return receipt;
  }
  active=null;
  if(validRef(receipt.binding?.bindingRef))
   await bridge.closeBinding({bindingRef:receipt.binding.bindingRef as string,hostRef});
  return {schema:SCHEMA,status:'PROCESS_IDENTITY_UNVERIFIED'};
 }
 return Object.freeze({
  inspect():Promise<U04Observation>{
   if(inFlight)return inFlight;
   const promise=serialize(performInspect);inFlight=promise;
   void promise.then(()=>{if(inFlight===promise)inFlight=null},
    ()=>{if(inFlight===promise)inFlight=null});
   return promise;
  },
  activate(binding:VerifiedWindow):Promise<U04Observation>{
   return serialize(async()=>{
    if(disposed||!active||binding.appRef!==APP||binding.hostRef!==hostRef||
       binding.bindingRef!==active.bindingRef||binding.processId!==active.pid||
       binding.processStamp!==active.processStamp)
     return {schema:SCHEMA,status:'BINDING_NOT_FOUND',focused:false};
    // U04 re-observes on activation. Never focus a different HWND from the
    // one the human selected, even if it belongs to the same process.
    requestedWindowRef=binding.windowRef;
    try{return await bridge.activate({bindingRef:active.bindingRef,hostRef});}
    finally{requestedWindowRef=null;}
   });
  },
  detach():Promise<void>{
   disposed=true;
   return serialize(async()=>{
    const previous=active;active=null;
    if(previous?.bindingRef)await bridge.closeBinding({bindingRef:previous.bindingRef,hostRef});
   });
  },
 });
}

/** The packaged owner source is copied byte-for-byte from the pinned U04
 * commit. The browser imports it at the authenticated Core /desktop/ origin. */
export async function loadNativeU04Controller(hostRef:string,nativeInvoke:NativeInvoke){
 const path='/desktop/u04/u04-presentation/bridge.mjs';
 const module=await import(/* @vite-ignore */ path);
 if(typeof module.createPresentationBridge!=='function'||
    module.SCHEMA!==SCHEMA)throw Error('U04_OWNER_SOURCE_UNAVAILABLE');
 return createNativeU04Controller(hostRef,nativeInvoke,module.createPresentationBridge as OwnerFactory);
}
