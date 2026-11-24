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
const signedStates=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const hex=v=>typeof v==='string'&&HEX.test(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&
  new Date(v).toISOString()===v;
const bounded=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
// Shape guard for an already verified native projection, not a license validator.
function inspectSignedTerms(terms){
 if(!exact(terms,['productVersion','featureIds','limits'])||
    typeof terms.productVersion!=='string'||terms.productVersion.length>96||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/.test(terms.productVersion)||
    !Array.isArray(terms.featureIds)||terms.featureIds.length>30||
    !terms.featureIds.every(id)||new Set(terms.featureIds).size!==terms.featureIds.length)
   denied();
 const l=terms.limits;
 if(!exact(l,['adminCenterSeats','employeeLimit','personalAgentSeats','quotas'])||
    !bounded(l.adminCenterSeats,1,10000)||!bounded(l.employeeLimit,1,100000)||
    !bounded(l.personalAgentSeats,0,l.employeeLimit)||!Array.isArray(l.quotas)||
    l.quotas.length>32)denied();
 const quotas=l.quotas.map(q=>{
   if(!exact(q,['metric','service','unit','period','max'])||!id(q.metric)||
      !['LOCAL','CLOUD'].includes(q.service)||
      !['COUNT','TOKENS','MINUTES','GIB','CREDITS'].includes(q.unit)||
      !['TOTAL','DAY','MONTH'].includes(q.period)||!bounded(q.max,1,1000000000))denied();
   return Object.freeze({...q});
 });
 return Object.freeze({productVersion:terms.productVersion,
  featureIds:Object.freeze([...terms.featureIds]),
  limits:Object.freeze({...l,quotas:Object.freeze(quotas)})});
}
function verifiedEnvelopeIdentity(v){
 if(!hex(v.licenseEnvelopeSha256)||!hex(v.statusEnvelopeSha256)||
    !signedStates.has(v.signedStatus)||
    (v.signedStatus==='REVOKED'?v.status!=='REVOKED':
      ![v.signedStatus,'STATUS_STALE','EXPIRED'].includes(v.status)))denied();
 return {licenseEnvelopeSha256:v.licenseEnvelopeSha256,
   statusEnvelopeSha256:v.statusEnvelopeSha256,signedStatus:v.signedStatus};
}
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
    !HEX.test(v.fingerprint)||
    v.trustOrigin!=='HOST_PREINSTALLED_PUBLIC_POLICY')denied();
 return Object.freeze({organizationId,intakeConfigured:true,
   fingerprint:v.fingerprint});
}
// Exact original native public fingerprint binds a lost-ACK recovery to the
// *same* publisher, never merely to "some trust exists" for this org.
export function inspectCorporatePinnedTrust(v,organizationId,expectedSha256){
 const installed=inspectCorporateCapabilities(v,organizationId);
 if(!HEX.test(expectedSha256)||installed.fingerprint!==expectedSha256)denied();
 return installed;
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
 const projected=[];
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
      !date(row.expiresAt)||!date(row.statusValidUntil)||
      Date.parse(row.statusValidUntil)>Date.parse(row.expiresAt)||
      (row.current?row.status!==row.signedStatus:
        !['REVOKED','STATUS_STALE','EXPIRED'].includes(row.status))||
      !hex(row.packageSha256)||
      row.activeSeats!==0||row.assignablePersonalAgentSeats!==0||
      row.productionActivation!==false)denied();
   seen.add(row.licenseId);
   projected.push(Object.freeze({
     licenseId:row.licenseId,requestId:row.requestId,
     issuerAuthorityId:row.issuerAuthorityId,
     organizationId,productId:row.productId,tariffId:row.tariffId,
     tariffRevision:row.tariffRevision,sequence:row.sequence,status:row.status,
     current:row.current,packageSha256:row.packageSha256,
     ...verifiedEnvelopeIdentity(row),signedTerms:inspectSignedTerms(row.signedTerms),
     expiresAt:row.expiresAt,statusValidUntil:row.statusValidUntil
   }));
 }
 return Object.freeze({organizationId,revision:view.revision,
   licenses:Object.freeze(projected),activeSeats:0,assignablePersonalAgentSeats:0});
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
   organizationId,productId:v.productId,licenseId:v.licenseId,
   requestId:v.requestId,issuerAuthorityId:v.issuerAuthorityId,
   tariffId:v.tariffId,tariffRevision:v.tariffRevision,
   status:v.status,sequence:v.sequence,revision:v.revision,
   ...verifiedEnvelopeIdentity(v),
   outcome:v.outcome,packageSha256:v.packageSha256,
   storedPackageSha256:v.storedPackageSha256,
   signedLicenseAccepted:true,holderApplied:false,
   assignablePersonalAgentSeats:0
 });
}

// An independent read after receive must contain the same signed LICENSE and
// same or later STATUS. A concurrent update is reported as such, never as the
// exact old STATUS. Expiry changes display status, not the signed envelope.
export function reconcileCorporateReceiveWithRead(receipt,view){
 const fail=()=>{throw Error('CEN04_CORPORATE_RECEIVE_READBACK_MISMATCH');};
 if(!receipt||!view||view.organizationId!==receipt.organizationId||
    view.revision<receipt.revision)fail();
 const row=view.licenses.find(x=>x.licenseId===receipt.licenseId);
 if(!row||!['organizationId','productId','requestId','issuerAuthorityId',
   'tariffId','tariffRevision','licenseEnvelopeSha256'].every(k=>row[k]===receipt[k])||
    row.sequence<receipt.sequence)fail();
 const newer=row.sequence>receipt.sequence;
 if(newer){
   if(view.revision===receipt.revision||row.statusEnvelopeSha256===receipt.statusEnvelopeSha256||
      (receipt.signedStatus==='REVOKED'&&row.signedStatus!=='REVOKED'))fail();
 }else if(row.statusEnvelopeSha256!==receipt.statusEnvelopeSha256||
          row.signedStatus!==receipt.signedStatus||
          row.packageSha256!==receipt.storedPackageSha256)fail();
 return Object.freeze({row,newer});
}
