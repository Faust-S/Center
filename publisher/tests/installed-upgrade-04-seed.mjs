// Public Windows installed-upgrade qualification. Use the real released 0.4
// draft model to create persistent user content before upgrading to 0.5.
// This is not a signer and does not issue or simulate product rights.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const [oldSource,dataFile,reportFile]=process.argv.slice(2);
const insist=(ok,code)=>{if(!ok)throw Error(code);};
insist(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&
  process.env.GITHUB_REPOSITORY==='Faust-S/Center',
  'PUBLISHER_04_UPGRADE_PUBLIC_ISOLATED_ACTIONS_ONLY');
insist([oldSource,dataFile,reportFile].every(x=>x&&isAbsolute(x)),
  'PUBLISHER_04_UPGRADE_ABSOLUTE_PATH_REQUIRED');
const {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft}=
  await import(pathToFileURL(join(resolve(oldSource),'publisher/src/preparation.mjs')).href);
let state=emptyPublisherDraft();
for(const command of [
  {kind:'addProduct',id:'IWXA_ATLAS',name:'Atlas Upgrade Baseline',version:'0.6.0'},
  {kind:'addHolder',id:'person:upgrade:publisher:001',
    name:'Upgrade Customer',type:'PERSON'},
  {kind:'addTariff',id:'PERSON_PLUS',productId:'IWXA_ATLAS',name:'Personal Plus',
    holderType:'PERSON',revision:1,features:['WORKSPACE'],termDays:30,
    productSeats:1,employeeLimit:0,deviceLimit:2,quotas:[]},
  {kind:'addTariffProposal',tariffId:'PERSON_PLUS',revision:1,
    productId:'IWXA_ATLAS',holderId:'person:upgrade:publisher:001'}
])state=applyPublisherDraftCommand(state,command);
const bytes=Buffer.from(encodePublisherDraft(state),'utf8');
mkdirSync(dirname(dataFile),{recursive:true});
if(existsSync(dataFile)){
  writeFileSync(join(dirname(reportFile),'upgrade-prior-05-draft.json'),
    readFileSync(dataFile),{flag:'wx'});
}
writeFileSync(dataFile,bytes);
insist(state.version===2&&state.products.length===1&&
  state.holders.length===1&&state.tariffs.length===1&&
  state.proposals.length===1&&state.proposals[0].tariffSnapshot.deviceLimit===2,
  'PUBLISHER_04_REAL_DRAFT_FIXTURE_INVALID');
writeFileSync(reportFile,JSON.stringify({
  schema:'IWXA_PUBLISHER_INSTALLED_UPGRADE_04_DRAFT/1',
  baseline:'0.4.0-dev.2',format:state.format,version:state.version,
  proposalId:state.proposals[0].id,
  holderId:state.holders[0].id,productId:state.products[0].id,
  draftSha256:createHash('sha256').update(bytes).digest('hex'),
  bytes:bytes.length
},null,2)+'\n',{flag:'wx'});
process.stdout.write('PUBLISHER_04_UPGRADE_ORIGINAL_MODEL_DRAFT_READY\n');