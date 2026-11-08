// Trusted Host-only forwarding. A preview is NEVER an admission receipt.
import {inspectCen04TestDeliveryText} from './cen04-test-delivery-preview.mjs';
import {createCen04ProductLicensePort} from './cen04-product-license.mjs';
export function receiveCen04TestDeliveryText({raw,organizationId,consumer}={}){
  inspectCen04TestDeliveryText(raw,{organizationId});
  const carrier=JSON.parse(raw);
  // Original T3 consumer verifies original signed envelopes against its own
  // host-installed trust and encrypted store. Never derive trust from carrier.
  const port=createCen04ProductLicensePort({consumer,organizationId});
  return port.receive({organizationId,license:carrier.license,
    statusEnvelope:carrier.statusEnvelope});
}

// Canonical .iwxa product transport. Only the trusted T3 owning runtime may
// supply inspectT3Iwxa (= original inspectTestProductDeliveryIwxa). Neither
// this adapter nor a browser preview implements a verifier, Store or issuer.
export function receiveCen04TestDeliveryIwxa({bytes,organizationId,consumer,inspectT3Iwxa}={}){
  if(typeof inspectT3Iwxa!=='function')throw Error('CEN04_T3_ORIGINAL_IWXA_INSPECTOR_REQUIRED');
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>4*1024*1024)
    throw Error('CEN04_IWXA_BYTES_INVALID');
  const parsed=inspectT3Iwxa(bytes);
  if(parsed?.integrityVerified!==true||parsed?.signatureVerified!==false||
    parsed?.productionActivation!==false||
    !parsed.pair?.license||!parsed.pair?.statusEnvelope)
    throw Error('CEN04_T3_IWXA_INTEGRITY_RESULT_REQUIRED');
  // The actual receipt is from the independent original T3 consumer. The
  // payload and package hash alone cannot produce a positive seat claim.
  const port=createCen04ProductLicensePort({consumer,organizationId});
  return port.receive({organizationId,license:parsed.pair.license,
    statusEnvelope:parsed.pair.statusEnvelope});
}
