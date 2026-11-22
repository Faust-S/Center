/** Stable human selection identity for retry reconciliation in the existing
 * SessionRuntime composer. Never an accepted Task ID or execution permission.
 */
export async function k03SelectionRef(parts){
 if(!Array.isArray(parts)||!parts.length||parts.length>8)
  throw Error('k03_selection_identity_invalid');
 const raw=new TextEncoder().encode(JSON.stringify(parts));
 if(raw.length>144000)throw Error('k03_selection_identity_oversize');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',raw);
 return 'K03-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
