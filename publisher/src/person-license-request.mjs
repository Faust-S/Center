// Pure Publisher-to-original-T3 PERSON request preparation.
// This file cannot sign, activate, export an entitlement or install trust.
// The original T3 owner alone issues PRODUCTION LICENSE + LICENSE_STATUS.
import {validatePublisherDraft} from './preparation.mjs';

export const PERSON_REQUEST_SCHEMA='IWXA_PUBLISHER_PERSON_LICENSE_REQUEST/1';
export const PERSON_REQUEST_PRODUCTS=Object.freeze(['IWXA_PERSONAL_AGENT','IWXA_ATLAS']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,63})?$/;
export class PersonLicenseRequestError extends Error{
  constructor(code){super(code);this.name='PersonLicenseRequestError';this.code=code;}
}
const reject=code=>{throw new PersonLicenseRequestError(code);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v,keys,code)=>{
  if(!plain(v)||Object.keys(v).length!==keys.length||
     keys.some(k=>!Object.hasOwn(v,k)))reject(code);
};
const validIso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&
  new Date(s).toISOString()===s;
export function validateUnsignedPersonLicenseRequest(input){
  exact(input,['schema','kind','requestId','requestedAt','environment','subject',
    'product','featureIds','termDays','seats','deviceLimit','quotas','status'],
    'PERSON_REQUEST_FIELDS_INVALID');
  if(input.schema!==PERSON_REQUEST_SCHEMA||input.kind!=='PERSON_LICENSE_REQUEST'||
     input.environment!=='PRODUCTION'||input.status!=='UNSIGNED_REQUEST')
    reject('PERSON_REQUEST_NOT_UNSIGNED');
  if(!ID.test(input.requestId)||!validIso(input.requestedAt))
    reject('PERSON_REQUEST_ID_OR_TIME_INVALID');
  exact(input.subject,['type','id','name'],'PERSON_REQUEST_SUBJECT_FIELDS_INVALID');
  if(input.subject.type!=='PERSON'||!ID.test(input.subject.id)||
     input.subject.id.startsWith('holder:')||
     typeof input.subject.name!=='string'||
     input.subject.name.length<1||input.subject.name.length>130||
     input.subject.name!==input.subject.name.trim())
    reject('PERSON_REQUEST_SUBJECT_INVALID');
  exact(input.product,['id','version'],'PERSON_REQUEST_PRODUCT_FIELDS_INVALID');
  if(!PERSON_REQUEST_PRODUCTS.includes(input.product.id)||
     !VERSION.test(input.product.version))reject('PERSON_REQUEST_PRODUCT_INVALID');
  if(!Array.isArray(input.featureIds)||input.featureIds.length<1||
     input.featureIds.length>30||
     input.featureIds.some(x=>typeof x!=='string'||!ID.test(x))||
     new Set(input.featureIds).size!==input.featureIds.length)
    reject('PERSON_REQUEST_FEATURES_INVALID');
  if(!Number.isSafeInteger(input.termDays)||input.termDays<1||input.termDays>3650)
    reject('PERSON_REQUEST_TERM_INVALID');
  if(input.seats!==1)reject('PERSON_REQUEST_SEATS_INVALID');
  if(!Number.isSafeInteger(input.deviceLimit)||input.deviceLimit<1||
     input.deviceLimit>100)reject('PERSON_REQUEST_DEVICES_INVALID');
  if(!Array.isArray(input.quotas)||input.quotas.length>32)
    reject('PERSON_REQUEST_QUOTAS_INVALID');
  const seen=new Set();
  for(const quota of input.quotas){
    exact(quota,['metric','service','unit','period','max'],
      'PERSON_REQUEST_QUOTA_FIELDS_INVALID');
    if(typeof quota.metric!=='string'||!ID.test(quota.metric)||
       !['LOCAL','CLOUD'].includes(quota.service)||
       !['COUNT','TOKENS','MINUTES','GIB','CREDITS'].includes(quota.unit)||
       !['TOTAL','DAY','MONTH'].includes(quota.period)||
       !Number.isSafeInteger(quota.max)||quota.max<1||quota.max>1000000000)
      reject('PERSON_REQUEST_QUOTA_INVALID');
    const k=[quota.service,quota.metric,quota.period].join(':');
    if(seen.has(k))reject('PERSON_REQUEST_QUOTA_DUPLICATE');
    seen.add(k);
  }
  return structuredClone(input);
}
export function prepareUnsignedPersonLicenseRequest(draft,{proposalId}){
  const state=validatePublisherDraft(draft);
  if(typeof proposalId!=='string'||!ID.test(proposalId))
    reject('PERSON_REQUEST_PROPOSAL_ID_INVALID');
  const proposal=state.proposals.find(p=>p.id===proposalId);
  if(!proposal||proposal.status!=='DRAFT_NOT_ISSUED'||!proposal.tariffSnapshot)
    reject('PERSON_REQUEST_SIGNED_SOURCE_NOT_READY');
  const holder=state.holders.find(h=>h.id===proposal.holderId);
  const product=state.products.find(p=>p.id===proposal.productId);
  const tariff=proposal.tariffSnapshot;
  if(!holder||holder.type!=='PERSON'||!product||
     !PERSON_REQUEST_PRODUCTS.includes(product.id)||
     tariff.holderType!=='PERSON'||tariff.productSeats!==1||
     tariff.employeeLimit!==0)
    reject('PERSON_REQUEST_SOURCE_SCOPE_UNSUPPORTED');
  if(holder.id.startsWith('holder:'))
    reject('PERSON_REQUEST_VERIFIED_PERSON_ID_REQUIRED');
  return validateUnsignedPersonLicenseRequest({
    schema:PERSON_REQUEST_SCHEMA,kind:'PERSON_LICENSE_REQUEST',
    requestId:proposal.id,requestedAt:proposal.createdAt,
    environment:'PRODUCTION',
    subject:{type:'PERSON',id:holder.id,name:holder.name},
    product:{id:product.id,version:proposal.productVersion},
    featureIds:[...proposal.features],termDays:proposal.termDays,
    seats:1,deviceLimit:tariff.deviceLimit,
    quotas:tariff.quotas.map(q=>({...q})),status:'UNSIGNED_REQUEST'
  });
}
