import {validatePublisherDraft} from './preparation.mjs';

// Publisher-only unsigned planning. NOT a licensed .iwxa envelope, signer,
// grants ledger, T3/Center authority, or a second offline license engine.
export const OFFLINE_PLAN_PREVIEW_SCHEMA = 'IWXA_PUBLISHER_OFFLINE_PLAN_PREVIEW/1';

export class OfflinePlanPreviewError extends Error {
  constructor(code){super(code);this.name='OfflinePlanPreviewError';this.code=code;}
}
const reject=code=>{throw new OfflinePlanPreviewError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function keys(value,expected,code){
  if(!plain(value)||Object.keys(value).length!==expected.length||
     expected.some(key=>!Object.hasOwn(value,key)))reject(code);
}
function identifier(value,code){
  if(typeof value!=='string'||value.length<1||value.length>90||
     !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value))reject(code);
}
function positive(value,limit,code){
  if(!Number.isSafeInteger(value)||value<1||value>limit)reject(code);
}
function quota(value){
  keys(value,['metric','service','unit','period','max'],'OFFLINE_PLAN_QUOTA_FIELDS_INVALID');
  identifier(value.metric,'OFFLINE_PLAN_QUOTA_METRIC_INVALID');
  if(!['LOCAL','CLOUD'].includes(value.service))reject('OFFLINE_PLAN_QUOTA_SERVICE_INVALID');
  if(!['COUNT','TOKENS','MINUTES','GIB','CREDITS'].includes(value.unit))
    reject('OFFLINE_PLAN_QUOTA_UNIT_INVALID');
  if(!['TOTAL','DAY','MONTH'].includes(value.period))
    reject('OFFLINE_PLAN_QUOTA_PERIOD_INVALID');
  positive(value.max,1_000_000_000,'OFFLINE_PLAN_QUOTA_MAX_INVALID');
}

// Uses the EXISTING Publisher recipient and product registry. Does not persist
// a new licensing store or mint a license; a signed product grant remains the
// responsibility of the established issuer, and each product verifies locally.
// Cloud usage is possible only while the corresponding service is connected.
export function prepareOfflineLicensePlanPreview(draft,input){
  const state=validatePublisherDraft(draft);
  keys(input,['holderId','productId','tariffCode','features','termDays',
    'productSeats','employeeLimit','deviceLimit','quotas'],'OFFLINE_PLAN_INPUT_FIELDS_INVALID');
  identifier(input.holderId,'OFFLINE_PLAN_HOLDER_ID_INVALID');
  identifier(input.productId,'OFFLINE_PLAN_PRODUCT_ID_INVALID');
  identifier(input.tariffCode,'OFFLINE_PLAN_TARIFF_ID_INVALID');
  const holder=state.holders.find(item=>item.id===input.holderId);
  const product=state.products.find(item=>item.id===input.productId);
  if(!holder||!product)reject('OFFLINE_PLAN_REFERENCE_MISSING');
  if(!Array.isArray(input.features)||input.features.length>30)
    reject('OFFLINE_PLAN_FEATURES_INVALID');
  input.features.forEach(item=>identifier(item,'OFFLINE_PLAN_FEATURES_INVALID'));
  if(new Set(input.features).size!==input.features.length)
    reject('OFFLINE_PLAN_FEATURES_DUPLICATE');
  positive(input.termDays,3650,'OFFLINE_PLAN_TERM_INVALID');
  positive(input.productSeats,10000,'OFFLINE_PLAN_PRODUCT_SEATS_INVALID');
  if(!Number.isSafeInteger(input.employeeLimit)||input.employeeLimit<0||
     input.employeeLimit>100000)reject('OFFLINE_PLAN_EMPLOYEES_INVALID');
  if(!Number.isSafeInteger(input.deviceLimit)||input.deviceLimit<0||
     input.deviceLimit>100)reject('OFFLINE_PLAN_DEVICES_INVALID');
  if(!Array.isArray(input.quotas)||input.quotas.length>32)
    reject('OFFLINE_PLAN_QUOTAS_INVALID');
  input.quotas.forEach(quota);
  const quotaIds=input.quotas.map(q=>q.metric+':'+q.period);
  if(new Set(quotaIds).size!==quotaIds.length)
    reject('OFFLINE_PLAN_QUOTAS_DUPLICATE');

  const org=holder.type==='ORGANIZATION';
  if(org){
    if(input.employeeLimit<1||input.deviceLimit!==0)
      reject('OFFLINE_PLAN_ORGANIZATION_LIMITS_INVALID');
  }else if(holder.type==='PERSON'){
    // A personal subscription has no staff delegation. Device slots are
    // independent of seats; activation/binding is not implemented here.
    if(input.productSeats!==1||input.employeeLimit!==0||input.deviceLimit<1)
      reject('OFFLINE_PLAN_PERSON_LIMITS_INVALID');
  }else reject('OFFLINE_PLAN_HOLDER_TYPE_INVALID');
  return {
    schema:OFFLINE_PLAN_PREVIEW_SCHEMA,
    status:'UNSIGNED_PREPARATION_ONLY',
    subject:{type:holder.type,id:holder.id,name:holder.name},
    product:{id:product.id,version:product.version},
    tariffCode:input.tariffCode,
    featureIds:[...input.features],
    termDays:input.termDays,
    limits:{productSeats:input.productSeats,employees:input.employeeLimit,
      devices:input.deviceLimit,quotas:input.quotas.map(q=>({...q,
        enforcement:q.service==='CLOUD'?'ONLINE_SERVICE_REQUIRED':'LOCAL_PRODUCT_CHECK'}))},
    entitlementRoute:org?'ORGANIZATION_ADMIN_CENTER':'PERSON_DIRECT_IN_PRODUCT',
    installationBinding:org?'ORGANIZATION_SUBJECT':'PERSON_INSTALLATION_PROOF_REQUIRED',
    offlineVerification:'SIGNED_IWXA_REQUIRED_NOT_PROVIDED',
    effectiveLicense:false,
    signedDelivery:false,
    productionActivation:false,
    activeSeats:0
  };
}
