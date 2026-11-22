/** Presentation-only contract for selected DOCX edits; grants no file authority. */
export type OfficeDocxRead = {taskId:string;workspaceId:string;path:string;sha256:string;bytes:number;text:string};
export function officeDocxPathValid(path:string):boolean{
 return typeof path==='string'&&path.length>0&&path.length<=160&&
  path===path.normalize('NFC')&&path.toLowerCase().endsWith('.docx')&&
  !path.startsWith('/')&&!path.endsWith('/')&&!path.includes('\\')&&
  path.split('/').every(s=>s.length>0&&s!=='..'&&s!=='.'&&
   !s.startsWith('.')&&s===s.trim()&&!/[<>:"|?*\u0000-\u001f\u007f-\u009f]/.test(s)&&
   !/[. ]$/.test(s)&&
   !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s));
}
export function officeDocxReviewKey(taskId:string,workspaceId:string,
 sourcePath:string,destinationPath:string,paragraph:string,source:OfficeDocxRead|null):string|null{
 if(!taskId||!workspaceId||!source||source.taskId!==taskId||
    source.workspaceId!==workspaceId||source.path!==sourcePath||
    !officeDocxPathValid(sourcePath)||!officeDocxPathValid(destinationPath)||
    sourcePath.toLowerCase()===destinationPath.toLowerCase()||
    typeof paragraph!=='string'||!paragraph.trim()||paragraph.length>16000||
    /[\t\r\n]/.test(paragraph)||
    !/^[0-9a-f]{64}$/.test(source.sha256)||
    !Number.isInteger(source.bytes)||source.bytes<1||source.bytes>680000)return null;
 return JSON.stringify([taskId,workspaceId,sourcePath,destinationPath,
  source.sha256,source.bytes,paragraph]);
}
