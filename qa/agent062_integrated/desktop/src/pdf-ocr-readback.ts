/** U01-classified PDF preview, not proof of installed or executed OCR. */
export type PdfOcrOffer={pagesTotal:number;pageNumbers:number[];sourceSha256:string};
export function verifiedPdfOcrOffer(input:unknown):PdfOcrOffer|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const d=input as Record<string,unknown>;
 if(d.root_id!=='personal'||typeof d.path!=='string'||!d.path.toLowerCase().endsWith('.pdf')
    ||d.format!=='pdf'||d.ocr_status!=='OCR_OFFER'||d.ocr_executor!=='OCRMY_PDF'
    ||d.ocr_performed!==false||typeof d.sha256!=='string'||!/^[0-9a-f]{64}$/.test(d.sha256)
    ||!Number.isSafeInteger(d.bytes)||Number(d.bytes)<1
    ||d.text!==''||d.offset_chars!==0||d.next_offset_chars!==null
    ||d.total_chars!==0||d.text_bytes!==0||d.partial!==false
    ||!Number.isSafeInteger(d.pages_total)||Number(d.pages_total)<1||Number(d.pages_total)>10000
    ||d.missing_pdf_pages!==d.pages_total||!Array.isArray(d.pages_without_text)
    ||d.pages_without_text.length!==d.pages_total)return null;
 const pages=d.pages_without_text;
 if(pages.some((page,i)=>!Number.isSafeInteger(page)||page!==i+1))return null;
 return {pagesTotal:Number(d.pages_total),pageNumbers:[...pages] as number[],
   sourceSha256:d.sha256};
}

/** A PDF offer is actionable only when it came from the currently bound
 * original LOCAL_FILES_V1 read port. PDF metadata without its ToolRuntime
 * receipt must never be promoted into a new OCR Task.
 */
export type VerifiedPdfOcrRead={offer:PdfOcrOffer;providerBindingDigest:string};
export function verifiedPdfOcrReadReceipt(value:unknown,sourcePath:string):VerifiedPdfOcrRead|null{
 const row=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:{};
 const response=row(value),receipt=row(response.receipt),data=row(response.data);
 const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 if(response.input_required===true||receipt.status!=='SUCCEEDED'||
    receipt.tool_id!=='files.read'||receipt.provider_slot!=='file_workspace'||
    receipt.provider_id!=='LOCAL_FILES_V1'||!digest(receipt.output_digest)||
    !digest(receipt.provider_binding_digest)||data.root_id!=='personal'||
    data.path!==sourcePath)return null;
 const offer=verifiedPdfOcrOffer(data);
 return offer?{offer,providerBindingDigest:String(receipt.provider_binding_digest)}:null;
}
