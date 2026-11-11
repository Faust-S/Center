// Admin Center 0.3: thin public CEN04 port to the installed T3 TEST consumer.
// This does NOT implement signing, cryptographic verification, storage, issuer
// provisioning, or organizational seat assignment. Those belong to T3.
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const SCHEMA='IWXA_T3_PRODUCT_LICENSE_CONSUMER_VIEW/1';
const PRODUCT='IWXA_ADMIN_CENTER';
const statuses=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

export function createCen04ProductLicensePort({consumer,organizationId}={}){
  ensure(typeof organizationId==='string'&&ID.test(organizationId),
    'CEN04_ORGANIZATION_REQUIRED');
  ensure(consumer && typeof consumer.view==='function' &&
    typeof consumer.receive==='function','CEN04_T3_CONSUMER_REQUIRED');
  const checkView=()=>{
    const view=consumer.view(); // Original T3 re-verifies signatures/currentness.
    ensure(view?.schema===SCHEMA && view.organizationId===organizationId &&
      view.productId===PRODUCT && Number.isSafeInteger(view.revision) &&
      view.revision>=0 && Array.isArray(view.licenses) &&
      view.trustOrigin==='HOST_PREINSTALLED_PUBLIC_POLICY' &&
      view.productionActivation===false && view.activeSeats===0 &&
      view.assignableSeats===0,'CEN04_OWNER_VERIFIED_VIEW_REQUIRED');
    const ids=new Set();
    const licenses=view.licenses.map(x=>{
      ensure(x && x.organizationId===organizationId && x.productId===PRODUCT &&
        typeof x.licenseId==='string' && ID.test(x.licenseId) &&
        !ids.has(x.licenseId) && x.signatureVerified===true &&
        x.statusVerified===true && statuses.has(x.status) &&
        Number.isSafeInteger(x.sequence) && x.sequence>=1 &&
        Number.isSafeInteger(x.claimedSeats) && x.claimedSeats>=1 &&
        x.activeSeats===0 && x.assignableSeats===0 &&
        x.commercialAuthorityProven===false && x.productionActivation===false,
        'CEN04_OWNER_VERIFIED_LICENSE_REQUIRED');
      ids.add(x.licenseId);
      return Object.freeze({licenseId:x.licenseId,status:x.status,
        sequence:x.sequence,claimedSeats:x.claimedSeats,
        activeSeats:0,assignableSeats:0,technicalSignatureVerified:true,
        commercialAuthorityProven:false});
    });
    return Object.freeze({status:licenses.length?'SIGNED_TEST_STATUS_VERIFIED':'NO_SIGNED_TEST_LICENSE',
      organizationId,productId:PRODUCT,revision:view.revision,licenses,
      activeSeats:0,assignableSeats:0,productionActivation:false,
      trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY'});
  };
  return Object.freeze({
    read:checkView,
    receive({organizationId:requestedOrg,license,statusEnvelope}={}){
      ensure(requestedOrg===organizationId,'CEN04_ORGANIZATION_MISMATCH');
      ensure(license && statusEnvelope,'CEN04_SIGNED_LICENSE_AND_STATUS_REQUIRED');
      // No self-trust fields or activation options are forwarded to T3.
      const receipt=consumer.receive({license,statusEnvelope});
      ensure(receipt && ['VERIFIED_TEST_SAVED','ALREADY_RECEIVED'].includes(receipt.outcome) &&
        receipt.organizationId===organizationId && receipt.productId===PRODUCT &&
        typeof receipt.licenseId==='string' && Number.isSafeInteger(receipt.sequence) &&
        Number.isSafeInteger(receipt.revision) &&
        receipt.signatureVerified===true && receipt.statusVerified===true &&
        receipt.activeSeats===0 && receipt.assignableSeats===0 &&
        receipt.commercialAuthorityProven===false && receipt.productionActivation===false,
        'CEN04_OWNER_VERIFIED_RECEIPT_REQUIRED');
      const observed=checkView();
      const row=observed.licenses.find(x=>x.licenseId===receipt.licenseId &&
        x.status===receipt.status && x.sequence===receipt.sequence);
      ensure(observed.revision===receipt.revision && row &&
        row.claimedSeats===receipt.claimedSeats,
        'CEN04_T3_DURABLE_READBACK_REQUIRED');
      return Object.freeze({status:'SIGNED_TEST_STATUS_VERIFIED',
        outcome:receipt.outcome,organizationId,productId:PRODUCT,
        licenseId:row.licenseId,sequence:row.sequence,licenseStatus:row.status,
        claimedSeats:row.claimedSeats,activeSeats:0,assignableSeats:0,
        productionActivation:false,revocationCurrentness:'LAST_VERIFIED_OFFLINE_EVENT'});
    },
    close(){consumer.close?.();}
  });
}
