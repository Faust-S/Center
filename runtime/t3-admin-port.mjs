import {createCen02Exchange} from './cen02-exchange.mjs';
import {createCen03Review} from './cen03-review.mjs';

// One facade for the existing T3 Admin runtime. CEN01 draft data and CEN05
// Atlas storage remain with their owners; CEN02/CEN03 add no second state.
export function createT3AdminPort(runtime,{openAtlas}={}) {
  if(runtime?.product!=='admin'||typeof runtime.snapshot!=='function')
    throw Error('T3_ADMIN_RUNTIME_REQUIRED');
  const snapshot=()=>runtime.snapshot();
  const bind=expected=>{
    const current=snapshot();
    if(!expected || current.organizationId!==expected.organizationId ||
        current.workspaceId!==expected.workspaceId ||
        current.contextEpoch!==expected.contextEpoch)throw Error('T3_CONTEXT_CHANGED');
    return current;
  };
  return Object.freeze({
    snapshot,
    ...createCen02Exchange({runtime,snapshot,bind,openAtlas}),
    ...createCen03Review({runtime,snapshot,bind})
  });
}
