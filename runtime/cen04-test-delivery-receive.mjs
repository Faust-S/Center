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
