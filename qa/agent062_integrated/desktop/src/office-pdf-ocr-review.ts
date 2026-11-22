import type {PdfOcrOffer} from './pdf-ocr-readback';

/** Explicit consent binds an exact PDF revision to a new output path. */
export type PdfScanSelection={taskId:string;workspaceId:string;path:string;
 sha256:string;pagesTotal:number;providerBindingDigest:string};
export function officePdfPathValid(path:string):boolean{
 return typeof path==='string'&&path.length>0&&path.length<=160&&
  path===path.normalize('NFC')&&/\.pdf$/i.test(path)&&
  !path.startsWith('/')&&!path.endsWith('/')&&!path.includes('\\')&&
  path.split('/').every(seg=>seg.length>0&&seg!=='.'&&seg!=='..'&&
   !seg.startsWith('.')&&seg===seg.trim()&&
   !/[<>:"|?*\u0000-\u001f]/.test(seg)&&!/[. ]$/.test(seg)&&
   !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(seg));
}
export function selectedPdfOcrReviewKey(taskId:string,workspaceId:string,
 sourcePath:string,destinationPath:string,selected:PdfScanSelection|null,
 offer:PdfOcrOffer|null):string|null{
 if(!taskId||!workspaceId||!selected||!offer||
    selected.taskId!==taskId||selected.workspaceId!==workspaceId||
    selected.path!==sourcePath||selected.sha256!==offer.sourceSha256||
    selected.pagesTotal!==offer.pagesTotal||
    !Number.isSafeInteger(selected.pagesTotal)||selected.pagesTotal<1||
    selected.pagesTotal>30||typeof selected.providerBindingDigest!=='string'||
    !/^[0-9a-f]{64}$/.test(selected.providerBindingDigest)||
    !officePdfPathValid(sourcePath)||
    !officePdfPathValid(destinationPath)||
    sourcePath.toLowerCase()===destinationPath.toLowerCase()||
    offer.pageNumbers.length!==offer.pagesTotal||
    offer.pageNumbers.some((p,i)=>p!==i+1))return null;
 return JSON.stringify([taskId,workspaceId,sourcePath,destinationPath,
   offer.sourceSha256,offer.pagesTotal,selected.providerBindingDigest,
   'OCRMY_PDF','NEW_COPY_ONLY']);
}

/** Review exact non-binary OCR action arguments before displaying an approval.
 * The ToolRuntime remains the only authority to execute the external U01 CLI.
 */
export type ReviewedPdfOcrPlan={rootId:string;sourcePath:string;path:string;
 sourceSha256:string;executableSha256:string};
export function reviewedPdfOcrPlan(target:unknown,argumentsValue:unknown):ReviewedPdfOcrPlan|null{
 if(!argumentsValue||typeof argumentsValue!=='object'||Array.isArray(argumentsValue))return null;
 const args=argumentsValue as Record<string,unknown>;
 if(Object.keys(args).length!==7||args.root_id!=='personal'||args.mode!=='create'||
    args.ocr_program_id!=='OCRMY_PDF'||typeof args.path!=='string'||
    typeof args.source_path!=='string'||args.path!==target||
    !officePdfPathValid(args.path)||!officePdfPathValid(args.source_path)||
    args.path.toLowerCase()===args.source_path.toLowerCase()||
    typeof args.expected_source_sha256!=='string'||
    !/^[0-9a-f]{64}$/.test(args.expected_source_sha256)||
    typeof args.expected_executable_sha256!=='string'||
    !/^[0-9a-f]{64}$/.test(args.expected_executable_sha256))return null;
 return {rootId:'personal',sourcePath:args.source_path,path:args.path,
   sourceSha256:args.expected_source_sha256,executableSha256:args.expected_executable_sha256};
}
/** This proves only what is on disk *now*. A historical acknowledged receipt
 * remains independent: without the U01 output SHA in an immutable receipt,
 * never claim that current bytes are necessarily identical to historical output.
 */
export function currentPdfOcrReadbackMatches(plan:ReviewedPdfOcrPlan,
 sourceValue:unknown,outputValue:unknown,previewValue:unknown):boolean{
 const row=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:{};
 const source=row(sourceValue),output=row(outputValue),preview=row(previewValue);
 return source.root_id===plan.rootId&&source.path===plan.sourcePath&&
  source.kind==='file'&&source.sha256===plan.sourceSha256&&
  output.root_id===plan.rootId&&output.path===plan.path&&
  output.kind==='file'&&Number.isSafeInteger(output.bytes)&&Number(output.bytes)>0&&
  Number(output.bytes)<=32*1024*1024&&typeof output.sha256==='string'&&
  /^[a-f0-9]{64}$/.test(output.sha256)&&
  preview.root_id===plan.rootId&&preview.path===plan.path&&
  preview.format==='pdf'&&preview.sha256===output.sha256&&
  preview.bytes===output.bytes&&
  preview.offset_chars===0&&typeof preview.text==='string'&&
  preview.text.trim().length>0&&Number.isSafeInteger(preview.total_chars)&&
  Number(preview.total_chars)>0&&preview.missing_pdf_pages===0;
}

/** Bind current disk observations to the exact OCR output SHA recorded in an
 * immutable, plan-scoped ToolRuntime execution receipt. This is read-only:
 * neither a fresh OCR run nor a missing witness can produce a verified state.
 */
export function receiptBoundPdfOcrReadbackMatches(plan:ReviewedPdfOcrPlan,
 receiptValue:unknown,sourceValue:unknown,outputValue:unknown,previewValue:unknown):boolean{
 if(!currentPdfOcrReadbackMatches(plan,sourceValue,outputValue,previewValue))return false;
 const row=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:{};
 const receipt=row(receiptValue),output=row(outputValue);
 return receipt.root_id===plan.rootId&&receipt.path===plan.path&&
  receipt.source_path===plan.sourcePath&&
  receipt.source_sha256===plan.sourceSha256&&
  receipt.ocr_executor==='OCRMY_PDF'&&
  receipt.readback_verified===true&&receipt.original_preserved===true&&
  typeof receipt.sha256==='string'&&/^[a-f0-9]{64}$/.test(receipt.sha256)&&
  receipt.sha256===output.sha256&&receipt.bytes===output.bytes&&
  Number.isSafeInteger(receipt.pages_total)&&Number(receipt.pages_total)>=1&&
  Number(receipt.pages_total)<=30;
}

/** Detect a moving filesystem target across the independent files.stat and
 * files.read observations. Equal digests establish stable bytes at both read
 * points; metadata changes are not treated as a verified cold readback.
 */
export function pdfOcrFileObservationsStable(
 sourceBefore:unknown,sourceAfter:unknown,outputBefore:unknown,outputAfter:unknown):boolean{
 const row=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:null;
 const same=(left:unknown,right:unknown):boolean=>{
  const a=row(left),b=row(right);
  return !!a&&!!b&&a.kind==='file'&&b.kind==='file'&&
   a.root_id===b.root_id&&a.path===b.path&&
   typeof a.sha256==='string'&&/^[a-f0-9]{64}$/.test(a.sha256)&&
   a.sha256===b.sha256&&Number.isSafeInteger(a.bytes)&&
   a.bytes===b.bytes;
 };
 return same(sourceBefore,sourceAfter)&&same(outputBefore,outputAfter);
}
