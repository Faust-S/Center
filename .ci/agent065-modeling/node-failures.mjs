// A second reporter for Node 22. This file is written only into the private
// temporary qualification directory. Never serialize titles or assertions.
export default async function* (source){
 for await(const event of source){
  if(event.type!=='test:fail')continue;
  const {file,line,column}=event.data||{};
  if(typeof file!=='string'||file.length>32768)continue;
  const position=value=>Number.isSafeInteger(value)&&value>=0&&value<=10_000_000?value:0;
  yield JSON.stringify({file,line:position(line),column:position(column)})+'\n';
 }
}
