/** Convert verified previous + user-selected current text into a normal Task
 * draft. It never creates a Task, approves an amendment or writes documents.
 */
const MAX_BYTES=48000;
const bytes=s=>new TextEncoder().encode(s).length;
export function prepareRevisionTaskDraft(file,language='ru'){
 if(!file||typeof file.name!=='string'||!file.name||typeof file.text!=='string'||
    !file.text.trim()||file.text.includes('\0')||bytes(file.text)>MAX_BYTES||
    !['ru','en'].includes(language))throw Error('k01_draft_invalid_input');
 const hasPrevious=file.previousText!==undefined;
 if(hasPrevious&&(typeof file.previousText!=='string'||!file.previousText.trim()||
    file.previousText.includes('\0')||bytes(file.previousText)+bytes(file.text)>MAX_BYTES))
  throw Error('k01_draft_previous_unavailable_or_over_budget');
 const originalName=file.name==='iwxa-previous-version.txt'?
  'iwxa-previous-version-2.txt':'iwxa-previous-version.txt';
 const attachments=hasPrevious?[{name:originalName,text:file.previousText},
  {name:file.name,text:file.text}]:[{name:file.name,text:file.text}];
 const taskText=hasPrevious?
  (language==='ru'?
   'Сравни две редакции документа: '+originalName+' - историческая, '+file.name+
   ' - новая. Составь таблицу «было / стало», проверь арифметику, сроки, условия и противоречия. Историческая редакция нужна только как контекст: не считай новые условия принятыми без решения человека. Не изменяй файлы.':
   'Compare the two document revisions: '+originalName+' is historical, '+file.name+
   ' is new. Show a before/after table, check arithmetic, dates, terms and contradictions. The historical file is reference context only: do not treat new terms as accepted without human review. Do not modify files.'):
  (language==='ru'?'Проанализируй этот документ и подготовь проверяемые выводы.':
   'Analyze this document and prepare verifiable findings.');
 return {mode:hasPrevious?'PAIRED_COMPARISON':'NEW_ONLY',text:taskText,attachments};
}
