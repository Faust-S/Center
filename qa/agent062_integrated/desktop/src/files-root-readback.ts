/** Verified, read-only observation of the active Personal Files destination.
 * This is a presentation helper, never an authority to write files.
 */
export type PersonalFolderRoot = {path:string;binding_digest:string;read_only:boolean};

type RecordValue = Record<string,unknown>;
const row=(value:unknown):RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 ? value as RecordValue:{};
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const localAbsolute=(path:string)=>/^[A-Za-z]:[\\/]/.test(path)||(path.startsWith('/')&&!path.startsWith('//'));

export function verifiedPersonalFolder(value:unknown,expectedBindingDigest?:string):PersonalFolderRoot{
 const response=row(value),receipt=row(response.receipt),data=row(response.data);
 if(response.input_required===true||receipt.status!=='SUCCEEDED'
    ||receipt.tool_id!=='files.roots'||receipt.provider_slot!=='file_workspace'
    ||receipt.provider_id!=='LOCAL_FILES_V1'
    ||!digest(receipt.output_digest)||!digest(receipt.provider_binding_digest))
  throw Error('personal_folder_receipt_unverified');
 if(expectedBindingDigest!==undefined&&receipt.provider_binding_digest!==expectedBindingDigest)
  throw Error('personal_folder_binding_changed');
 if(!Array.isArray(data.roots))throw Error('personal_folder_roots_missing');
 const personal=data.roots.map(row).filter(root=>root.root_id==='personal');
 if(personal.length!==1)throw Error('personal_folder_root_ambiguous');
 const root=personal[0],path=root.path;
 if(typeof path!=='string'||!path||path.length>4096||!localAbsolute(path)||typeof root.read_only!=='boolean')
  throw Error('personal_folder_root_not_writable');
 return {path,binding_digest:receipt.provider_binding_digest,read_only:root.read_only};
}
