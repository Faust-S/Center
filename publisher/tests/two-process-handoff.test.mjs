import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {emptyDraft,applyDraftCommand} from '../../src/organization.mjs';
import {emptyPublisherDraft,applyPublisherDraftCommand} from '../src/preparation.mjs';
import {prepareTestLicenseRequest} from '../src/test-license-request.mjs';
import {simulateIssuerEvent} from '../src/issuer-simulation.mjs';
const ORG='00000000-0000-4000-8000-000000000001';
const NOW='2026-11-08T14:00:00.000Z';
const stamp=()=>NOW;
function input(){
 let center=applyDraftCommand(emptyDraft(),{type:'CREATE_ORGANIZATION',name:'Cross-process company',kind:'ORGANIZATION'},{id:()=>ORG,now:stamp});
 let pub=emptyPublisherDraft();
 pub=applyPublisherDraftCommand(pub,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Admin',version:'0.3.0'});
 pub=applyPublisherDraftCommand(pub,{kind:'addHolder',id:ORG,name:'Cross-process company',type:'ORGANIZATION'});
 pub=applyPublisherDraftCommand(pub,{kind:'addProposal',productId:'IWXA_ADMIN_CENTER',holderId:ORG,features:['WORKSPACE'],termDays:30});
 const request=prepareTestLicenseRequest(pub,{proposalId:pub.proposals[0].id,seats:5});
 const event=simulateIssuerEvent(request,{observedAt:NOW,sequence:1});
 return {centerDraft:center,request,event,observedAt:NOW};
}
function run(data,dir,name){
 const incoming=join(dir,name+'.in.json'),outgoing=join(dir,name+'.out.json');
 writeFileSync(incoming,JSON.stringify(data));
 const r=spawnSync(process.execPath,['publisher/tests/center-preview-child.mjs',incoming,outgoing],
   {encoding:'utf8',cwd:process.cwd(),timeout:10000});
 return {run:r,preview:r.status===0?JSON.parse(readFileSync(outgoing,'utf8')):null};
}
test('actual two-process offline handoff persists a non-authorizing Center preview',t=>{
 const dir=mkdtempSync(join(tmpdir(),'iwxa-publisher-two-process-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const data=input(),source=JSON.stringify(data.centerDraft);
 const {run:child,preview}=run(data,dir,'match');
 assert.equal(child.status,0,child.stderr);
 assert.equal(preview.state,'MATCHED_TEST_SIMULATION');
 assert.equal(preview.modeledRequestedSeats,5);
 assert.equal(preview.actualLicensedSeats,0);
 assert.equal(preview.actualGrantedSeats,0);
 assert.equal(preview.issuerTrust,'NOT_EVALUATED');
 assert.equal(preview.canAssignSeats,false);
 assert.equal(JSON.stringify(data.centerDraft),source);
 const again=JSON.parse(readFileSync(join(dir,'match.out.json'),'utf8'));
 assert.deepEqual(again,preview);
});
test('separate consumer process fails closed for holder mismatch and revoked event',t=>{
 const dir=mkdtempSync(join(tmpdir(),'iwxa-publisher-two-process-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const data=input();
 const changed={...data,request:{...data.request,subject:{...data.request.subject,id:'other-org'}}};
 const mismatch=run(changed,dir,'wrong-holder').preview;
 assert.equal(mismatch.state,'ORGANIZATION_NOT_FOUND');
 assert.equal(mismatch.actualLicensedSeats,0);
 const revoked=run({...data,event:simulateIssuerEvent(data.request,{observedAt:NOW,decision:'SIMULATED_REVOKED',sequence:2})},dir,'revoked').preview;
 assert.equal(revoked.state,'SIMULATED_REVOKED');
 assert.equal(revoked.canAssignSeats,false);
});
test('separate consumer process rejects an authority-bearing forged result altogether',t=>{
 const dir=mkdtempSync(join(tmpdir(),'iwxa-publisher-two-process-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const data=input();
 const {run:child}=run({...data,event:{...data.event,authority:true,signature:'pretend'}},dir,'invalid');
 assert.equal(child.status,1);
 assert.match(child.stderr,/CENTER_SIMULATION_REJECTED/);
});
