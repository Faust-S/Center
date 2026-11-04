import {createT3AdminPort} from './t3-admin-port.mjs';

// Thin Node host adapter for the separately approved private technology
// package. Neither the WebView nor this module owns signed carriers, grants,
// encryption, Reconciliation or the persistent organization ledger.
// The Windows host is NOT wired until its approved owner distribution exists.
const allowed=new Set(['exportIssuedTask','receive','inspect','decide',
  'previewApplication','decideApplication','commitApplication']);
const check=(value,code)=>{if(!value)throw Error(code);};
const decodeBinary=value=>{
  check(Array.isArray(value)&&value.length>0&&value.length<=8*1024*1024&&
    value.every(n=>Number.isInteger(n)&&n>=0&&n<=255),'CEN_PACKAGE_BYTES_INVALID');
  return Uint8Array.from(value);
};
const encodeCarrier=bytes=>{
  check(bytes instanceof Uint8Array&&bytes.byteLength>0,'CEN_OWNER_CARRIER_REQUIRED');
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
  return Object.freeze({
    state({organizationId}){
      const snapshot=observe(organizationId);
      return {status:'OWNER_READY',snapshot};
    },
    async action({organizationId,operation,input={},binding}={}){
      check(typeof organizationId==='string','CEN_OWNER_ORGANIZATION_REQUIRED');
      observe(organizationId);
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
      if(operation==='exportIssuedTask')return {...value,bytes:encodeCarrier(value.bytes)};
      return value;
    },
    close(){runtime.close?.()}
  });
}
