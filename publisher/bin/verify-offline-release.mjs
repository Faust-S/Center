#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {verifySourceCheckout,verifyTwoOfflineCopies} from '../src/release-origin.mjs';

const [manifestPath,checkoutRoot,copyOne,copyTwo,...extra]=process.argv.slice(2);
if(!manifestPath||!checkoutRoot||!copyOne||!copyTwo||extra.length){
 process.stderr.write('Usage: node publisher/bin/verify-offline-release.mjs manifest.json clean-checkout copy-A copy-B\n');
 process.exitCode=2;
}else{
 try{
  const bytes=await readFile(manifestPath);
  if(bytes.length>32768)throw new Error('RELEASE_INPUT_TOO_LARGE');
  const manifest=JSON.parse(bytes.toString('utf8'));
  const source=await verifySourceCheckout(manifest,checkoutRoot);
  const copies=await verifyTwoOfflineCopies(manifest,[copyOne,copyTwo]);
  process.stdout.write(JSON.stringify({
    result:'SOURCE_CHECKOUT_AND_TWO_COPIES_CHECKED_NOT_RELEASE_APPROVED',
    source,copies,buildProvenanceVerified:false,
    signedReleaseMetadataVerified:false,releaseApproved:false
  },null,2)+'\n');
 }catch(e){
  process.stderr.write('PUBLISHER_OFFLINE_CHECK_REJECTED: '+(e.code||e.message||'UNKNOWN_ERROR')+'\n');
  process.exitCode=1;
 }
}
