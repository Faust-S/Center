import {officeDocxPathValid} from './office-docx-review';
import {officePdfPathValid} from './office-pdf-ocr-review';

export type OfficeFileKind='docx'|'pdf';
export type OfficeFileEntry={kind:'file'|'dir';name:string;path:string;bytes:number|null};
export type OfficeFileListing={folder:string;entries:OfficeFileEntry[];truncated:boolean};
type Row=Record<string,unknown>;
const row=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const segment=(name:unknown):name is string=>typeof name==='string'&&
 name.length>0&&name.length<=160&&name===name.normalize('NFC')&&
 name===name.trim()&&!name.startsWith('.')&&
 !/[\\/<>:"|?*\u0000-\u001f\u007f-\u009f]/.test(name)&&!/[. ]$/.test(name)&&
 !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
export const officeFolderPathValid=(path:string):boolean=>
 typeof path==='string'&&path.length<=160&&
 (path===''||path.split('/').every(segment));
const fileValid=(path:string,kind:OfficeFileKind)=>kind==='docx'
 ?officeDocxPathValid(path):officePdfPathValid(path);
export function officeCopySuggestion(path:string,kind:OfficeFileKind):string{
 if(!fileValid(path,kind))return '';
 const dot=path.lastIndexOf('.');
 const copy=path.slice(0,dot)+(kind==='docx'?'-edited.docx':'-searchable.pdf');
 return fileValid(copy,kind)&&copy.toLowerCase()!==path.toLowerCase()?copy:'';
}
/** A list is read-only navigation. It never licenses a native launch or write.
 * Both the receipt and the selected Workspace are rechecked by the caller.
 */
export function verifiedOfficeFileListing(value:unknown,folder:string,kind:OfficeFileKind):OfficeFileListing{
 if(!officeFolderPathValid(folder)||!['docx','pdf'].includes(kind))
  throw Error('office_file_browse_path_invalid');
 const response=row(value),receipt=row(response.receipt),data=row(response.data);
 if(response.input_required===true||receipt.status!=='SUCCEEDED'||
    receipt.tool_id!=='files.list'||receipt.provider_id!=='LOCAL_FILES_V1'||
    receipt.provider_slot!=='file_workspace'||!digest(receipt.output_digest)||
    !digest(receipt.provider_binding_digest)||data.root_id!=='personal'||
    data.path!==folder||!Array.isArray(data.items)||data.items.length>100)
  throw Error('office_file_browse_receipt_unverified');
 const entries:OfficeFileEntry[]=[];
 for(const item of data.items){
  const x=row(item),name=x.name;
  if(!segment(name)||!['dir','file'].includes(String(x.kind))||
     (x.sha256!==undefined&&x.sha256!==null&&!digest(x.sha256))||
     (x.bytes!==undefined&&x.bytes!==null&&
       (!Number.isSafeInteger(x.bytes)||Number(x.bytes)<0)))
   throw Error('office_file_browse_entry_invalid');
  const path=folder?folder+'/'+name:name;
  if(x.kind==='dir'){
   if(officeFolderPathValid(path))entries.push({kind:'dir',name,path,bytes:null});
  }else if(fileValid(path,kind)){
   entries.push({kind:'file',name,path,
    bytes:typeof x.bytes==='number'?x.bytes:null});
  }
 }
 return {folder,entries,truncated:data.items.length===100};
}
