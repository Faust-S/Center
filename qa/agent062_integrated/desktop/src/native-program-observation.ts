/** Read-only U03/U04 presentation. A vault connection is not a native window. */
export type U03Observation = {
 schema?:unknown;
 levels?:Array<{level?:unknown;verified?:unknown}>;
 verifiedOperations?:unknown;
};
export type U04Observation = {
 schema?:unknown;status?:unknown;focused?:unknown;
 binding?:{appRef?:unknown;hostRef?:unknown;windowRef?:unknown;
  bindingRef?:unknown;processId?:unknown;processStamp?:unknown};
};
export type U04SurfaceObservation = {
 schema?:unknown;status?:unknown;
 binding?:{
  schema?:unknown;mode?:unknown;appRef?:unknown;hostRef?:unknown;
  bindingRef?:unknown;runtimeRef?:unknown;sessionRef?:unknown;
  surfaceRef?:unknown;mountRef?:unknown;official?:unknown;
  verified?:unknown;existingRuntime?:unknown;spawned?:unknown;mounted?:unknown;
 };
};
export type VerifiedWindow = {
 bindingRef:string;hostRef:string;appRef:string;
 processId:number;processStamp:string|null;windowRef:string;
};
export type IntegrationPresentation = {
 discovered:boolean;dataReady:boolean;functionsVerified:boolean;
 windowVerified:boolean;nativeWindowSupported:boolean;embeddedSupported:boolean;embeddedVerified:boolean;
 windowState:'observed'|'lost'|'unverified';activation:VerifiedWindow|null;
};
const token=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const levels=(u03:U03Observation|undefined):Set<string>=>{
 if(u03?.schema!=='IWXA_UI_INTEGRATION/1.0.0'||!Array.isArray(u03.levels))return new Set();
 return new Set(u03.levels.filter(item=>item?.verified===true&&
  typeof item.level==='string'&&/^I[0-5]$/.test(item.level)).map(item=>item.level as string));
};
/** I4 confirms embedding support only. A live/mounted U04 owner receipt
 * additionally proves an actual, existing and officially hosted surface. */
export function verifiedEmbeddedSurface(observation:U04SurfaceObservation|undefined,
 appRef:string,hostRef:string):boolean{
 const b=observation?.binding;
 return observation?.schema==='IWXA_PRESENTATION_SURFACE/1.0.0'
  &&['SURFACE_MOUNTED','SURFACE_LIVE'].includes(String(observation.status))
  &&b?.schema==='IWXA_PRESENTATION_SURFACE/1.0.0'
  &&b.mode==='EMBEDDED_VIEW'&&b.appRef===appRef&&b.hostRef===hostRef
  &&b.official===true&&b.verified===true&&b.existingRuntime===true
  &&b.spawned===false&&b.mounted===true
  &&[b.bindingRef,b.runtimeRef,b.sessionRef,b.surfaceRef,b.mountRef].every(token);
}

/** The same owner statuses must have the same meaning in the projection
 * and in the result of the user's explicit focus action. */
export function nativeWindowLost(status:unknown):boolean{
 return [
  'WINDOW_NOT_FOUND','WINDOW_OBSERVATION_FAILED','WINDOW_FOCUS_DENIED',
  'WINDOW_FOCUS_FAILED','PROCESS_IDENTITY_CHANGED','PROCESS_IDENTITY_UNVERIFIED',
  'PROCESS_EXITED','BOUND_NO_WINDOW','BINDING_CLOSED',
 ].includes(String(status));
}

const owned=(observation:U04Observation|undefined,appRef:string,hostRef:string)=>
 observation?.schema==='IWXA_PRESENTATION_BRIDGE/1.0.0' && token(appRef) && token(hostRef) &&
 observation.binding?.appRef===appRef && observation.binding.hostRef===hostRef &&
 token(observation.binding.bindingRef);
export function verifiedNativeBinding(observation:U04Observation|undefined,
 appRef:string,hostRef:string):VerifiedWindow|null{
 if(!owned(observation,appRef,hostRef)
  ||!['WINDOW_OBSERVED','WINDOW_FOCUSED'].includes(String(observation?.status))
  ||(observation?.status==='WINDOW_FOCUSED'&&observation.focused!==true))return null;
 const b=observation!.binding!;
 if(!token(b.windowRef)||!Number.isSafeInteger(b.processId)||Number(b.processId)<=0
  ||(b.processStamp!==null&&b.processStamp!==undefined&&!token(b.processStamp)))return null;
 return {appRef,hostRef,bindingRef:b.bindingRef as string,processId:b.processId as number,
  processStamp:token(b.processStamp)?b.processStamp:null,windowRef:b.windowRef};
}
/** U04 re-observes HWND/identity on every activate. UI checks that the receipt
 * still refers to the exact process and binding that the human selected. */
export function confirmedNativeActivation(receipt:U04Observation|undefined,
 bound:VerifiedWindow):boolean{
 return receipt?.schema==='IWXA_PRESENTATION_BRIDGE/1.0.0'
  &&receipt.status==='WINDOW_FOCUSED'&&receipt.focused===true
  &&receipt.binding?.appRef===bound.appRef&&receipt.binding.hostRef===bound.hostRef
  &&receipt.binding.bindingRef===bound.bindingRef
  &&receipt.binding.processId===bound.processId
  &&(bound.processStamp===null||receipt.binding.processStamp===bound.processStamp)
  &&receipt.binding.windowRef===bound.windowRef;
}
/** I3 confirms support for window integration, not a currently observed window.
 * Only a matching U04 binding proves which window is present. */
export function presentProgramIntegration(input:{detected:boolean;dataReady:boolean;
 u03?:U03Observation;u04?:U04Observation;u04Surface?:U04SurfaceObservation;
 appRef:string;hostRef?:string}):IntegrationPresentation{
 const verified=levels(input.u03);
 const hostRef=input.hostRef||'';
 const binding=verifiedNativeBinding(input.u04,input.appRef,hostRef);
 const lost=owned(input.u04,input.appRef,hostRef)&&nativeWindowLost(input.u04?.status);
 const windowVerified=!lost&&!!binding;
 return {discovered:input.detected||verified.has('I0')||!!binding,
  dataReady:input.dataReady||verified.has('I1'),
  functionsVerified:verified.has('I2'),windowVerified,
  nativeWindowSupported:verified.has('I3')||windowVerified,embeddedSupported:verified.has('I4'),
  embeddedVerified:verified.has('I4') &&
   verifiedEmbeddedSurface(input.u04Surface,input.appRef,hostRef),
  windowState:lost?'lost':windowVerified?'observed':'unverified',activation:lost?null:binding};
}
