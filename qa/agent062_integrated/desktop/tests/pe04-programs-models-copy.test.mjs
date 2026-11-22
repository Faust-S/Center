import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const programs=read('programs-center.tsx');
const models=read('models-control.tsx');
const native=read('native-program-link.tsx');
const nativeState=read('native-program-observation.ts');
const cli=read('public-programs-control.tsx');

test('PE04-04 touched native, model and program surfaces parse as TSX or TypeScript',()=>{
 for(const [name,source] of [
  ['programs-center.tsx',programs],['models-control.tsx',models],
  ['native-program-link.tsx',native],['native-program-observation.ts',nativeState],
  ['public-programs-control.tsx',cli],
 ]){
  const ast=ts.createSourceFile(name,source,ts.ScriptTarget.ES2022,true,
   name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],name);
 }
});

test('PE04-04 an unassigned model stays unassigned and the user sees a next step',()=>{
 assert.match(models,/activeModelPresentation\(route,engine\.pin,ai\.selected_model/);
 assert.match(models,/activeModel\.kind==='NONE'\?tr\('Не выбрана','Not selected'\)/);
 assert.match(models,/activeModel\.responseVerified/);
 assert.match(models,/Модель для новых запросов пока не выбрана/);
 assert.match(models,/Выберите модель для запросов/);
 assert.doesNotMatch(models,/route==='NONE'\?\(str\(record\(engine\.pin\)\.name\)/);
 assert.doesNotMatch(models,/tr\('[^'\n]*Python Core/);
});

test('PE04-04 Programs dialog traps keyboard focus and returns it to the trigger',()=>{
 assert.match(programs,/ref=\{programDialogRef\}/);
 assert.match(programs,/role="dialog" aria-modal="true"/);
 assert.match(programs,/aria-labelledby="iwxa-program-dialog-title"/);
 assert.match(programs,/onKeyDown=\{onProgramDialogKeyDown\}/);
 assert.match(programs,/dialog\.querySelector<HTMLButtonElement>\('\.program-modal-header button'\)\?\.focus\(\)/);
 assert.match(programs,/if\(origin\?\.isConnected\)origin\.focus\(\)/);
 assert.match(programs,/event\.key==='Escape'/);
 assert.match(programs,/event\.key!=='Tab'/);
 assert.match(programs,/event\.shiftKey/);
 const dialog=programs.slice(programs.indexOf('const onProgramDialogKeyDown='),
  programs.indexOf('const selectedReceipt=',programs.indexOf('const onProgramDialogKeyDown=')));
 assert.doesNotMatch(dialog,/runtime\.command|tool_execute|spawn/);
});

test('PE04-04 observed window requires U04 binding while native support is a separate fact',()=>{
 assert.match(nativeState,/const windowVerified=!lost&&!!binding/);
 assert.match(nativeState,/nativeWindowSupported:verified\.has\('I3'\)/);
 assert.match(native,/view\.nativeWindowSupported/);
 assert.match(native,/Текущее окно/);
 assert.match(native,/Переход к окну пока недоступен/);
 assert.match(native,/<details className="native-program-details">/);
 assert.match(native,/Не подтверждено/);
 assert.doesNotMatch(native,/runtime\.command|spawn\(|fetch\(/);
});

test('PE04-04 authorial tone names a useful action and avoids low-level status on the main surface',()=>{
 assert.match(programs,/Доступ подтверждён/);
 assert.doesNotMatch(programs,/Запланировано\. Программа не подключена/);
 assert.match(programs,/Некоторые программы пока есть только в каталоге/);
 assert.match(programs,/Связь с программой проверена\. Выберите, что сделать дальше/);
 assert.match(programs,/Встроенные возможности и подключения/);
 assert.doesNotMatch(programs,/T3 запрещает IWXA/);
 assert.match(cli,/currentProgramConnection\(view\)/);
 assert.match(cli,/Программа подключена\. Для выполнения действия понадобится отдельное подтверждение/);
 assert.match(cli,/<details className="program-technical-details">/);
 assert.doesNotMatch(cli,/Зарегистрированные CLI-программы не обнаружены в PATH/);
});
