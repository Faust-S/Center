// Narrow installed Tauri IPC consumer. The OS, executable, and window are
// exclusively selected and validated by Center's native host.
const valid = x => typeof x==='string'&&x.length>0&&x.length<=256;
const validWork = x => x&&valid(x.organizationId)&&valid(x.projectId)&&
  valid(x.workId)&&typeof x.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(x.revision);
const checked = response => {
  if(!response||response.schema!=='IWXA_PRESENTATION_BRIDGE/1.0.0'||
      typeof response.status!=='string'||response.openedWorkAutomatically!==false)
    throw Error('CEN05_NATIVE_RESPONSE_INVALID');
  return response;
};
export function createCen05NativePort(invoke) {
  if(typeof invoke!=='function')throw Error('CEN05_NATIVE_HOST_UNAVAILABLE');
  return Object.freeze({
    async open(ref) {
      if(!validWork(ref))throw Error('CEN05_WORK_REF_INVALID');
      return checked(await invoke('center_u04_open',ref));
    },
    async activate(ref) {
      if(!validWork(ref)||!valid(ref.bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_activate',ref));
    },
    async returnToCenter(ref) {
      if(!validWork(ref)||!valid(ref.bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_return',ref));
    },
    async detach({organizationId,bindingRef}) {
      if(!valid(organizationId)||!valid(bindingRef))throw Error('CEN05_BINDING_INVALID');
      return checked(await invoke('center_u04_detach',{organizationId,bindingRef}));
    }
  });
}
