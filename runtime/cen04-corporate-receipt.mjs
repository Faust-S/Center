// Native UI guards for receipts returned by the ORIGINAL qualified T3
// Consumer. No signature verification, rights engine or Store in React.
const SCHEMA='IWXA_T3_CORPORATE_CONSUMER_NATIVE_RECEIPT/1';
const VIEW='IWXA_T3_CORPORATE_PRODUCT_LICENSE_CONSUMER_VIEW/1';
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const states=new Set(['ACTIVE','SUSPENDED','REVOKED','STATUS_STALE','EXPIRED']);
const denied=()=>{throw Error('CEN04_CORPORATE_ORIGINAL_T3_RECEIPT_REQUIRED')};
const id=v=>typeof v==='string'&&ID.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=1;
const base=v=>v?.schema===SCHEMA&&v.activeSeats===0&&
  v.assignablePersonalAgentSeats===0&&v.productionActivation===false;
export function inspectCorporateEnrollment(v,organizationId,fingerprint){
 if(!base(v)||v.operation!=='CORPORATE_ENROLLED'||
    v.organizationId!==organizationId||v.fingerprint!==fingerprint||
    !HEX.test(fingerprint)||v.intakeConfigured!==true||
    v.publicOnly!==true||v.recipientConfirmed!==false||
    v.trustOrigin!=='HOST_PREINSTALLED_PUBLIC_POLICY')denied();
 return Object.freeze({organizationId,intakeConfigured:true});
}
export function inspectCorporateCapabilities(v,organizationId){
 if(!base(v)||v.operation!=='CORPORATE_CAPABILITIES'||
    v.organizationId!==organizationId||v.productId!=='IWXA_ADMIN_CENTER'||
    v.intakeConfigured!==true||v.recipientConfirmed!==false||
    v.trustOrigin!=='HOST_PREINSTALLED_PUBLIC_POLICY')denied();
 return Object.freeze({organizationId,intakeConfigured:true});
}
export function inspectCorporateRead(v,organizationId){
 const view=v?.view;
 if(!base(v)||v.operation!=='CORPORATE_READ'||
    view?.schema!==VIEW||view.organizationId!==organizationId||
    view.productId!=='IWXA_ADMIN_CENTER'||
    view.trustOrigin!=='HOST_PREINSTALLED_PUBLIC_POLICY'||
    !Number.isSafeInteger(view.revision)||view.revision<0||
    view.activeSeats!==0||view.assignablePersonalAgentSeats!==0||
    view.productionActivation!==false||!Array.isArray(view.licenses))denied();
 const seen=new Set();
 for(const row of view.licenses){
   if(!id(row?.licenseId)||seen.has(row.licenseId)||
      !id(row.requestId)||!id(row.issuerAuthorityId)||
      row.organizationId!==organizationId||
      row.productId!=='IWXA_ADMIN_CENTER'||
      !id(row.tariffId)||!count(row.tariffRevision)||
      !states.has(row.status)||!count(row.sequence)||
      row.signatureVerified!==true||row.statusVerified!==true||
      row.recipientConfirmed!==true||row.originalHolderReceiptRequired!==true||
      typeof row.current!=='boolean'||
      row.activeSeats!==0||row.assignablePersonalAgentSeats!==0||
      row.productionActivation!==false)denied();
   seen.add(row.licenseId);
 }
 return Object.freeze({organizationId,revision:view.revision,
   licenses:Object.freeze(view.licenses.map(row=>Object.freeze({
     licenseId:row.licenseId,issuerAuthorityId:row.issuerAuthorityId,
     tariffId:row.tariffId,sequence:row.sequence,status:row.status,
     current:row.current
   }))),activeSeats:0,assignablePersonalAgentSeats:0});
}
export function inspectCorporateReceived(v,organizationId,expectedSha256){
 if(!base(v)||v.operation!=='CORPORATE_RECEIVE'||
    v.organizationId!==organizationId||v.productId!=='IWXA_ADMIN_CENTER'||
    !id(v.licenseId)||!id(v.requestId)||!id(v.issuerAuthorityId)||
    !id(v.tariffId)||!count(v.tariffRevision)||
    !states.has(v.status)||!count(v.sequence)||!count(v.revision)||
    !['VERIFIED_CORPORATE_SAVED','ALREADY_RECEIVED'].includes(v.outcome)||
    !HEX.test(expectedSha256)||v.packageSha256!==expectedSha256||
    !HEX.test(v.storedPackageSha256)||
    v.trustOrigin!=='HOST_PREINSTALLED_PUBLIC_POLICY'||
    v.signatureVerified!==true||v.statusVerified!==true||
    v.statusFloorVerified!==true||v.signedLicenseAccepted!==true||
    v.recipientConfirmed!==true||v.originalHolderReceiptRequired!==true||
    v.holderApplied!==false)denied();
 return Object.freeze({
   organizationId,licenseId:v.licenseId,issuerAuthorityId:v.issuerAuthorityId,
   status:v.status,sequence:v.sequence,revision:v.revision,
   outcome:v.outcome,packageSha256:v.packageSha256,
   signedLicenseAccepted:true,holderApplied:false,
   assignablePersonalAgentSeats:0
 });
}
