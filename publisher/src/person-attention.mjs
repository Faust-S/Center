// Read-only issuer-side attention summary. The ORIGINAL T3 owns all signed
// licenses, statuses and durable receipts. This projection grants no rights,
// cannot verify a recipient and never persists a second license inventory.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const instant=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&
  Number.isFinite(Date.parse(value));
const validId=value=>typeof value==='string'&&ID.test(value);
const DAY=86400000, HOUR=3600000;
const PRODUCTS=new Set(['IWXA_ATLAS','IWXA_PERSONAL_AGENT']);
const STATES=new Set(['NOT_ACTIVATED','ACTIVE','SUSPENDED','REVOKED']);
function reject(code){throw Error(code);}
export function inspectPublisherPersonOwnerInventory(value){
  if(value?.operation!=='PERSON_INVENTORY'||value.activeSeats!==0||
    value.productionActivation!==false||!Array.isArray(value.licenses)||
    value.licenses.length>48||!Number.isSafeInteger(value.total)||
    value.total<value.licenses.length||typeof value.truncated!=='boolean')
    reject('PUBLISHER_ATTENTION_ORIGINAL_INVENTORY_REQUIRED');
  const seen=new Set();
  for(const row of value.licenses){
    if(!row||!validId(row.licenseId)||seen.has(row.licenseId)||
      !validId(row.requestId)||!validId(row.issuerAuthorityId)||
      !validId(row.personId)||!PRODUCTS.has(row.productId)||
      !STATES.has(row.status)||typeof row.requestDigest!=='string'||
      !SHA.test(row.requestDigest)||!Number.isSafeInteger(row.sequence)||
      row.sequence<0||row.activeSeats!==0||
      !Number.isSafeInteger(row.deviceLimit)||row.deviceLimit<1||
      !Number.isSafeInteger(row.quotaCount)||row.quotaCount<0||
      !instant(row.issuedAt)||!instant(row.notBefore)||!instant(row.expiresAt)||
      Date.parse(row.issuedAt)>Date.parse(row.notBefore)||
      Date.parse(row.notBefore)>=Date.parse(row.expiresAt)||
      (row.status==='NOT_ACTIVATED'?
        row.statusIssuedAt!==undefined||row.statusValidUntil!==undefined:
        !instant(row.statusIssuedAt)||!instant(row.statusValidUntil))||
      (row.statusValidUntil!==undefined&&
        (Date.parse(row.statusIssuedAt)>=Date.parse(row.statusValidUntil)||
         Date.parse(row.statusValidUntil)>Date.parse(row.expiresAt)))||
      (row.renewalOfLicenseId!==undefined&&
        (!validId(row.renewalOfLicenseId)||row.renewalOfLicenseId===row.licenseId)))
      reject('PUBLISHER_ATTENTION_ORIGINAL_ENTRY_INVALID');
    seen.add(row.licenseId);
  }
  return value.licenses;
}
export function projectPublisherPersonAttention(value,{now=Date.now()}={}){
  const entries=inspectPublisherPersonOwnerInventory(value);
  if(!Number.isFinite(now)||now<0)reject('PUBLISHER_ATTENTION_TIME_INVALID');
  const items=[];
  for(const row of entries){
    const expiry=Date.parse(row.expiresAt);
    let priority=0,title='';
    if(row.status==='REVOKED'){
      priority=1;title='Отзыв подписан: проверить доставку получателю';
    }else if(expiry<=now){
      priority=2;title='Срок лицензии завершился: проверить продление';
    }else if(row.status==='NOT_ACTIVATED'){
      priority=3;title='Лицензия выдана без подписанного STATUS';
    }else if(row.status==='SUSPENDED'){
      priority=4;title='Приостановление подписано: проверить доставку';
    }else if(Date.parse(row.statusValidUntil)<=now){
      priority=5;title='Подписанный STATUS устарел';
    }else if(expiry<=now+7*DAY){
      priority=6;title='Срок лицензии истекает в течение 7 дней';
    }else {
      const statusIssued=Date.parse(row.statusIssuedAt);
      const statusEnd=Date.parse(row.statusValidUntil);
      const lead=Math.min(6*HOUR,Math.floor((statusEnd-statusIssued)/4));
      if(statusEnd<=now+lead){
        priority=7;title='Приближается срок обновления STATUS';
      }
    }
    if(priority)items.push({licenseId:row.licenseId,personId:row.personId,
      productId:row.productId,priority,title,status:row.status,
      expiresAt:row.expiresAt,statusValidUntil:row.statusValidUntil??null});
  }
  items.sort((a,b)=>a.priority-b.priority||
    a.expiresAt.localeCompare(b.expiresAt)||a.licenseId.localeCompare(b.licenseId));
  return {source:'ORIGINAL_T3_ISSUER_INVENTORY_ONLY',
    total:value.total,shown:entries.length,truncated:value.truncated,
    attentionInShown:items.length,items,
    recipientConfirmed:false,productionActivation:false,activeSeats:0};
}
