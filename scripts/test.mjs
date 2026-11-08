import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=['tests','publisher/tests'].flatMap(dir=>readdirSync(dir).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>dir+'/'+name));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;
process.exit(result.status??1);
