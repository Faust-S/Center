import {createT3AdminPort} from './t3-admin-port.mjs';

// Thin Node host adapter for the separately approved private technology
// package. Neither the WebView nor this module owns signed carriers, grants,
// encryption, Reconciliation or the persistent organization ledger.
// The Windows host is NOT wired until its approved owner distribution exists.
const allowed=new Set(['selectStaff','selectOperator','exportIssuedTask','receive','inspect','decide',
  'previewApplication','decideApplication','commitApplication']);
const check=(value,code)=>{if(!value)throw Error(code);};
// The original T3 IWXA transport limit is 32 MiB. This boundary must match
// Center's native file picker; its 8 MiB JSON draft limit is unrelated.
export const MAX_CEN_IWXA_CARRIER_BYTES=32*1024*1024;
const decodeBinary=value=>{
  check(Array.isArray(value)&&value.length>0&&
    value.length<=MAX_CEN_IWXA_CARRIER_BYTES,'CEN_PACKAGE_BYTES_INVALID');
  // Array.prototype.every skips holes. A sparse carrier must not silently
  // become an altered zero-filled package before T3 verifies signatures.
  for(const n of value)check(Number.isInteger(n)&&n>=0&&n<=255,'CEN_PACKAGE_BYTES_INVALID');
  return Uint8Array.from(value);
};
const encodeCarrier=bytes=>{
  check(bytes instanceof Uint8Array&&bytes.byteLength>0,'CEN_OWNER_CARRIER_REQUIRED');
  check(bytes.byteLength<=MAX_CEN_IWXA_CARRIER_BYTES,'CEN_OWNER_CARRIER_LIMIT');
  return Array.from(bytes);
};
export function createCorporateOwnerHost({runtime,openAtlas,resolveAssignment}={}){
  const port=createT3AdminPort(runtime,{openAtlas});
  const observe=organizationId=>{
    const snapshot=port.snapshot();
    check(snapshot.organizationId===organizationId&&snapshot.product==='admin',
      'CEN_OWNER_ORGANIZATION_MISMATCH');
    return snapshot;
  };
  // The T3 reference scenario explicitly reports both flags false.
  // It can qualify the API, but must not be advertised as an activated
  // organizational product, or execute a corporate action in Center.
  const activated=snapshot=>snapshot.productionActivation===true&&snapshot.T3_READY===true;
  return Object.freeze({
    state({organizationId}){
      const snapshot=observe(organizationId);
      return activated(snapshot)
        ? {status:'OWNER_READY',snapshot}
        : {status:'REFERENCE_ONLY',reason:'T3 technology qualification is not production activation',
            snapshot:{product:snapshot.product,organizationId:snapshot.organizationId,
              workspaceId:snapshot.workspaceId,contextEpoch:snapshot.contextEpoch,
              productionActivation:false,T3_READY:false}};
    },
    async action({organizationId,operation,input={},binding}={}){
      check(typeof organizationId==='string','CEN_OWNER_ORGANIZATION_REQUIRED');
      const current=observe(organizationId);
      check(activated(current),'CEN_OWNER_PRODUCTION_NOT_ACTIVATED');
      check(binding?.organizationId===organizationId,'CEN_OWNER_ORGANIZATION_MISMATCH');
      check(typeof operation==='string','CEN_OWNER_OPERATION_INVALID');
      check(input&&typeof input==='object'&&!Array.isArray(input),'CEN_OWNER_INPUT_INVALID');
      if(operation==='issue'){
        check(typeof resolveAssignment==='function','CEN_VERIFIED_ASSIGNMENT_RESOLVER_REQUIRED');
        const resolved=await resolveAssignment({organizationId,assignmentId:input.assignmentId,binding});
        check(resolved?.organization?.id===organizationId &&
          resolved.assignment?.id===input.assignmentId,
          'CEN_VERIFIED_ASSIGNMENT_MISMATCH');
        // Resolve recipient/reviewer through the real organizational owner,
        // never by inferring a T3 personId from a draft participant label.
        const value=await port.issue({organization:resolved.organization,
          assignment:resolved.assignment,binding:resolved.binding});
        return {...value,bytes:encodeCarrier(value.bytes)};
      }
      check(allowed.has(operation),'CEN_OWNER_OPERATION_NOT_SUPPORTED');
      const args={...input,binding};
      if(operation==='receive')args.bytes=decodeBinary(input.bytes);
      const value=await port[operation](args);
      if(operation==='selectStaff'||operation==='selectOperator'){
        // Both selections revoke the old UI contextEpoch. Do not accept a
        // synthetic selection receipt or continue if production readiness was lost.
        check(activated(observe(organizationId)),'CEN_OWNER_SELECTION_NOT_READY');
      }
      if(operation==='exportIssuedTask')return {...value,bytes:encodeCarrier(value.bytes)};
      return value;
    },
    close(){runtime.close?.()}
  });
}
