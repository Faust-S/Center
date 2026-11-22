import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
const programs=read('programs-center.tsx');
const work=read('workbench.tsx');
const observation=read('native-program-observation.ts');

test('existing Programs Center presents optional U03/U04 observation without a new runtime',()=>{
 for(const [name,source] of [['programs-center.tsx',programs],['workbench.tsx',work],
  ['native-program-observation.ts',observation]]){
  const ast=ts.createSourceFile(name,source,ts.ScriptTarget.ES2022,true,
   name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(ast.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')),[],name);
 }
 assert.match(programs,/openProgram==='OBSIDIAN_V1'&&<NativeProgramLink/);
 assert.match(programs,/dataReady=\{programHealth\.OBSIDIAN_V1===true\}/);
 assert.match(programs,/nativeHostRef\?:string;nativeU03\?:U03Observation;nativeU04\?:U04Observation/);
 assert.match(programs,/onReturnToTask=\{\(\)=>\{setOpenProgram\(''\);onNavigate\('Задачи'\)\}\}/);
});

test('window focus is not inferred from connected vault and cannot launch unconfirmed programs',()=>{
 assert.match(observation,/observation\?\.schema==='IWXA_PRESENTATION_BRIDGE\/1\.0\.0'/);
 assert.match(observation,/receipt\.status==='WINDOW_FOCUSED'/);
 assert.match(observation,/receipt\.binding\.processId===bound\.processId/);
 assert.match(observation,/PROCESS_IDENTITY_CHANGED/);
 assert.doesNotMatch(programs,/runtime\.command\(['"]native_program_launch/);
});

test('Core Task and pending recovery remain on central workbench',()=>{
 assert.match(work,/const taskComposer=\(/);
 assert.match(work,/pending_submission:intent/);
 assert.match(work,/submissionRecoveryNotice&&<div className="advanced-notice"/);
 assert.match(work,/if\(workspaceSwitchInFlight\.current\)return;/);
});
