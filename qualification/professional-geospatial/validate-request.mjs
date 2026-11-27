// Deliberate one-shot qualification, public inputs only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const workflow='workflow-professional-geo',path='.github/ci-requests/'+workflow+'.json';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const e=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const before=e.before,head=process.env.GITHUB_SHA;
assert.equal(process.env.GITHUB_EVENT_NAME,'push');
assert.equal(e.created,false);assert.equal(e.deleted,false);assert.equal(e.forced,false);
assert.match(before,/^[a-f0-9]{40}$/);assert.match(head,/^[a-f0-9]{40}$/);
assert.equal(e.after,head);assert.equal(process.env.GITHUB_REF,'refs/heads/ci/once/'+workflow+'/'+before);
assert.equal(e.ref,process.env.GITHUB_REF);
assert.equal(git('rev-parse','HEAD'),head);
assert.equal(git('rev-list','--parents','-n','1',head),head+' '+before);
assert.equal(git('diff','--name-status',before,head),'A\t'+path);
assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{workflow,prepared:before,
 profile:'public-original-geo-benchmark',pins:{osmBlob:'63346b4ce8b8907b02563e2c9ec7813e4bbb5abd',osrm:'26.8.0',valhalla:'3.8.2'},
 reason:'Qualify both original road engines on identical historical public OSM bytes and original QGIS CRS/GeoPackage processing'});
console.log('EXACT_PUBLIC_GEO_REQUEST_PASS');
