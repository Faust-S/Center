// CEN05 consumer of the existing U04 presentation port. This module does
// not launch OS processes, discover executables, manage windows or own Atlas.
// The installed host must supply both U01-approved launch and U05 observation.
const fail=code=>{throw Error(code);};
const validText=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const validWorkRef=ref=>validText(ref?.projectId)&&validText(ref?.workId)&&
  typeof ref?.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(ref.revision);
const compatible=port=>port&&typeof port.capabilities==='function'&&
  typeof port.open==='function'&&typeof port.activate==='function'&&
  typeof port.closeBinding==='function';
const allowedOpening=new Set(['WINDOW_OBSERVED','LAUNCHED_NO_WINDOW']);
const observationMatches=(observation,ref)=>observation?.status==='SOURCE_REVISION_MATCHES'&&
  observation.projectId===ref.projectId&&observation.workId===ref.workId&&
  String(observation.revision)===ref.revision;

export function createCen05PresentationConsumer({u04,observeWork,resolveLaunch}={}) {
  const available=()=>compatible(u04)&&typeof observeWork==='function'&&
    typeof resolveLaunch==='function';
  async function preflight({organizationId,workRef}) {
    if(!validText(organizationId)||!validWorkRef(workRef))fail('CEN05_WORK_REF_INVALID');
    if(!available())return {status:'PRESENTATION_NOT_CONNECTED'};
    const observed=await observeWork({organizationId,workRef});
    // An uncertain or outdated read may never be silently treated as current.
    if(!observationMatches(observed,workRef))
      return {status:'WORK_SOURCE_NOT_CURRENT',observationStatus:observed?.status??'NOT_OBSERVED'};
    return {status:'SOURCE_REVISION_MATCHES'};
  }
  async function openAtlas({organizationId,hostRef,workRef}) {
    if(!validText(hostRef))fail('CEN05_HOST_INVALID');
    const observation=await preflight({organizationId,workRef});
    if(observation.status!=='SOURCE_REVISION_MATCHES')return observation;
    const capabilities=u04.capabilities();
    if(capabilities?.schema!=='IWXA_PRESENTATION_BRIDGE/1.0.0'||
       !capabilities.capabilities?.some(c=>c.mode==='LAUNCH'&&c.supported===true))
      return {status:'PRESENTATION_LAUNCH_UNSUPPORTED'};
    // U01 supplies an already-authorized executable specification. The
    // WorkRef never becomes a path, window handle or launch argument here.
    const source=await resolveLaunch({appRef:'iwxa.atlas',hostRef,organizationId,workRef});
    if(source?.authorized!==true||!source.launchSpec||
       typeof source.launchSpec!=='object'||Array.isArray(source.launchSpec))
      return {status:'ATLAS_LAUNCH_NOT_AUTHORIZED'};
    const result=await u04.open({appRef:'iwxa.atlas',hostRef,launchSpec:source.launchSpec});
    if(!allowedOpening.has(result?.status)||result?.binding?.hostRef!==hostRef||
       result.binding.appRef!=='iwxa.atlas'||!validText(result.binding.bindingRef))
      return {status:result?.status??'PRESENTATION_OPEN_UNCONFIRMED'};
    // No Atlas deep-link has been qualified; a launched window is not proof
    // that the desired project/work is selected in the external application.
    return {status:result.status,bindingRef:result.binding.bindingRef,
      workRef:{...workRef},openedWorkAutomatically:false};
  }
  async function activateAtlas({organizationId,hostRef,workRef,bindingRef}) {
    if(!validText(hostRef)||!validText(bindingRef))fail('CEN05_BINDING_INVALID');
    const observation=await preflight({organizationId,workRef});
    if(observation.status!=='SOURCE_REVISION_MATCHES')return observation;
    const result=await u04.activate({bindingRef,hostRef});
    return {status:result?.status??'PRESENTATION_ACTIVATION_UNCONFIRMED',
      focused:result?.status==='WINDOW_FOCUSED'&&result.focused===true,
      openedWorkAutomatically:false};
  }
  async function detachAtlas({hostRef,bindingRef}) {
    if(!validText(hostRef)||!validText(bindingRef))fail('CEN05_BINDING_INVALID');
    if(!compatible(u04))return {status:'PRESENTATION_NOT_CONNECTED'};
    const result=await u04.closeBinding({bindingRef,hostRef});
    return {status:result?.status??'PRESENTATION_DETACH_UNCONFIRMED',
      processTerminated:false};
  }
  return Object.freeze({preflight,openAtlas,activateAtlas,detachAtlas});
}
