import {readFileSync,writeFileSync} from 'node:fs';
import {previewSimulatedPublisherSeats} from '../../runtime/cen04-publisher-preview.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)process.exit(2);
try{
 const content=readFileSync(input,'utf8');
 if(Buffer.byteLength(content,'utf8')>1024*1024)throw Error('SIMULATION_TRANSFER_OVERSIZED');
 const data=JSON.parse(content);
 const result=previewSimulatedPublisherSeats(data);
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
} catch(e) {
 process.stderr.write('CENTER_SIMULATION_REJECTED: '+(e.code||e.message||'UNKNOWN')+'\n');
 process.exitCode=1;
}
