/** A bounded *presentation-only* comparison of two verified text snapshots.
 * It cannot assert K01 field authority, approve a source or create a Task.
 */
const MAX_BYTES=48000,MAX_LINES=2000,MAX_CHANGES=24;
const bytes=s=>new TextEncoder().encode(s).length;
const hasControl=s=>/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s);
const normalizedLines=s=>{
 const lines=s.replace(/\r\n?/g,'\n').split('\n');
 if(lines.at(-1)==='')lines.pop();
 if(lines.length>MAX_LINES)throw new TypeError('k01_preview_too_many_lines');
 return lines;
};
function visibleField(line,index){
 const v=line.trim().replace(/^(?:[-*+]\s+|\d+\.\s+)/,'');
 let label='',value='';
 if(v.startsWith('|')&&v.endsWith('|')){
  const cells=v.slice(1,-1).split('|');
  if(cells.length!==2)return null;
  label=cells[0].trim();value=cells[1].trim();
 }else{
  const colon=v.indexOf(':');
  if(colon<2)return null;
  label=v.slice(0,colon).trim();value=v.slice(colon+1).trim();
 }
 label=label.replace(/\*\*/g,'').trim();
 if(!label||label.length>100||!value||!/[\p{L}]/u.test(label)||/^https?$/i.test(label))return null;
 return {key:label.toLocaleLowerCase('ru-RU'),label,value,line:index+1};
}
function indexedFields(lines){
 const found=new Map(),ambiguous=new Set();
 for(let i=0;i<lines.length;i++){
  const row=visibleField(lines[i],i);
  if(!row)continue;
  if(found.has(row.key))ambiguous.add(row.key);
  else found.set(row.key,row);
 }
 return {found,ambiguous};
}
export function compareDocumentRevisions(previous,current){
 if(typeof previous!=='string'||typeof current!=='string'||
    bytes(previous)>MAX_BYTES||bytes(current)>MAX_BYTES||
    hasControl(previous)||hasControl(current))throw new TypeError('k01_preview_invalid_text');
 const prior=normalizedLines(previous),next=normalizedLines(current);
 const before=indexedFields(prior),after=indexedFields(next);
 const ambiguous=[...new Set([...before.ambiguous,...after.ambiguous])].sort();
 const keys=[...new Set([...before.found.keys(),...after.found.keys()])].sort();
 const changes=[];
 for(const key of keys){
  if(before.ambiguous.has(key)||after.ambiguous.has(key))continue;
  const a=before.found.get(key),b=after.found.get(key);
  if(a?.value===b?.value&&!!a===!!b)continue;
  changes.push({label:b?.label??a?.label??key,kind:!a?'ADDED':!b?'REMOVED':'CHANGED',
   before:a?.value??null,after:b?.value??null,
   beforeLine:a?.line??null,afterLine:b?.line??null});
 }
 // A common-prefix/suffix sample is not proof that all remaining lines
 // are unchanged; always retain the full-file changed flag.
 let prefix=0;
 while(prefix<prior.length&&prefix<next.length&&prior[prefix]===next[prefix])prefix++;
 let aEnd=prior.length,bEnd=next.length;
 while(aEnd>prefix&&bEnd>prefix&&prior[aEnd-1]===next[bEnd-1]){aEnd--;bEnd--;}
 const changed=previous!==current;
 return {contentChanged:changed,structuredChanges:changes.slice(0,MAX_CHANGES),
  totalStructuredChanges:changes.length,hiddenStructuredChanges:Math.max(0,changes.length-MAX_CHANGES),
  ambiguousLabels:ambiguous.slice(0,MAX_CHANGES),ambiguousCount:ambiguous.length,
  lineSample:changed?{beforeStart:prefix+1,afterStart:prefix+1,
   before:prior.slice(prefix,Math.min(aEnd,prefix+6)),after:next.slice(prefix,Math.min(bEnd,prefix+6)),
   beforeOmitted:Math.max(0,aEnd-prefix-6),afterOmitted:Math.max(0,bEnd-prefix-6)}:null};
}
