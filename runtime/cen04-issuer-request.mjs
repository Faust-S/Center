import {
  validateTestLicenseRequest, encodeTestLicenseRequest, suggestedTestRequestFileName
} from '../publisher/src/test-license-request.mjs';

// Admin Center prepares a request for the EXISTING Publisher TEST issuer.
// This is not a license, not an organization grant and not a T3 Store.
/** @param {{
 * organization:{kind:'GROUP'|'ORGANIZATION',id:string,name:string},
 * requestId:string, requestedAt:string, version?:string,
 * featureIds?:string[], termDays?:number, seats?:number
 * }} options */
export function prepareAdminPublisherTestRequest({
  organization, requestId, requestedAt, version='0.3.0',
  featureIds=['WORKSPACE'], termDays=30, seats=1
}){
  if(organization?.kind!=='ORGANIZATION')
    throw Error('CEN04_PUBLISHER_ORGANIZATION_KIND_REQUIRED');
  const request=validateTestLicenseRequest({
    schema:'IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1',
    kind:'TEST_LICENSE_REQUEST',
    requestId,requestedAt,environment:'TEST',
    subject:{type:'ORGANIZATION',id:organization.id,name:organization.name},
    product:{id:'IWXA_ADMIN_CENTER',version},
    featureIds,termDays,seats,status:'UNSIGNED_REQUEST'
  });
  return Object.freeze({
    request,
    content:encodeTestLicenseRequest(request),
    suggestedFileName:suggestedTestRequestFileName(request)
  });
}
