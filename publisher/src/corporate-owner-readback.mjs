// Read-only guard for the EXISTING ORIGINAL T3 corporate issuer ledger.
// This module neither issues licenses nor persists rights or source data.
// Its only purpose is to prevent an uncertain/previous ISSUE from becoming
// an accidental second signing operation in Publisher's native UI.
export class CorporateOwnerReadbackError extends Error{
 constructor(code){super(code);this.name='CorporateOwnerReadbackError';this.code=code;}
}
const deny=code=>{throw new CorporateOwnerReadbackError(code);};
const id=value=>typeof value==='string'&&
 /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);

export function inspectCorporateIssuePreflight(value,requestId){
 if(!id(requestId))deny('CORPORATE_PREFLIGHT_REQUEST_ID_INVALID');
 if(value?.operation!=='CORPORATE_INVENTORY'||
    value.lookupId!==requestId||value.productionActivation!==false||
    value.activeSeats!==0||value.truncated!==false||
    !Number.isSafeInteger(value.matches)||value.matches<0||value.matches>1||
    !Number.isSafeInteger(value.total)||value.total<value.matches||
    !Array.isArray(value.licenses)||value.licenses.length!==value.matches)
   deny('CORPORATE_PREFLIGHT_EXACT_ORIGINAL_LEDGER_REQUIRED');
 if(value.matches===0)return Object.freeze({state:'NOT_SIGNED',requestId});
 const entry=value.licenses[0];
 if(!entry||entry.requestId!==requestId||!id(entry.licenseId))
   deny('CORPORATE_PREFLIGHT_SIGNED_SCOPE_INVALID');
 return Object.freeze({state:'ALREADY_SIGNED',requestId,licenseId:entry.licenseId});
}
