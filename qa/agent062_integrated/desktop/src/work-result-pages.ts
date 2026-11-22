/** UTF-16 page offsets for large durable worker outputs.
 * Slicing happens only for the displayed page; no copies of hidden pages.
 * Keep surrogate pairs intact, including at the 8k-character boundary.
 */
export const WORK_RESULT_PAGE_CHARS = 8000;

export function workResultPageOffsets(text:string):number[]{
 const offsets=[0];
 for(let start=0;start<text.length;){
  let end=Math.min(start+WORK_RESULT_PAGE_CHARS,text.length);
  if(end<text.length){
   const last=text.charCodeAt(end-1),next=text.charCodeAt(end);
   if(last>=0xD800&&last<=0xDBFF&&next>=0xDC00&&next<=0xDFFF)end++;
  }
  offsets.push(end);
  start=end;
 }
 return offsets;
}
