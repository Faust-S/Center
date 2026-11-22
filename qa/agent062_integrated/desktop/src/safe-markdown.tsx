import {Fragment,memo,type ReactNode} from 'react';

/** Small readable Markdown presentation, not a browser HTML renderer. */
export function safeResultUrl(raw:string):string|null{
 if(raw.length>2048||!/^https?:\/\//i.test(raw))return null;
 try{
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  return url.href;
 }catch{return null;}
}
function inline(text:string,depth=0):ReactNode[]{
 if(depth>=3)return [text];
 const pattern=/(\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\`([^\`\n]+)\`|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~)/g;
 const out:ReactNode[]=[];let offset=0;let m:RegExpExecArray|null;
 while((m=pattern.exec(text))!==null){
  if(m.index>offset)out.push(text.slice(offset,m.index));
  const k=out.length;
  if(m[2]!==undefined){
   const url=safeResultUrl(m[3]);
   out.push(url?<a key={k} href={url} target="_blank" rel="noopener noreferrer">{m[2]}</a>:m[0]);
  }else if(m[4]!==undefined||m[5]!==undefined){
   out.push(<strong key={k}>{inline(m[4]??m[5],depth+1)}</strong>);
  }else if(m[6]!==undefined){out.push(<code key={k}>{m[6]}</code>);}
  else if(m[7]!==undefined||m[8]!==undefined){out.push(<em key={k}>{inline(m[7]??m[8],depth+1)}</em>);}
  else out.push(<s key={k}>{inline(m[9],depth+1)}</s>);
  offset=pattern.lastIndex;
 }
 if(offset<text.length)out.push(text.slice(offset));
 return out.length?out:[text];
}

type TableAlign='left'|'center'|'right';
/** Split only unescaped table pipes outside inline code spans. */
function tableCells(line:string):string[]{
 let body=line.trim();
 if(body.startsWith('|'))body=body.slice(1);
 if(body.endsWith('|'))body=body.slice(0,-1);
 const cells:string[]=[];let cell='',ticks=0;
 for(let i=0;i<body.length;i++){
  const char=body[i];
  if(char==='\\'&&body[i+1]==='|'){cell+='|';i++;continue;}
  if(char.charCodeAt(0)===96){
   let count=1;
   while(i+count<body.length&&body.charCodeAt(i+count)===96)count++;
   if(ticks===0)ticks=count;else if(ticks===count)ticks=0;
   cell+=body.slice(i,i+count);i+=count-1;continue;
  }
  if(char==='|'&&ticks===0){cells.push(cell.trim());cell='';}
  else cell+=char;
 }
 cells.push(cell.trim());
 return cells;
}
function tableDefinition(header:string,separator:string):{headers:string[];align:TableAlign[]}|null{
 if(!header.includes('|')||!separator.includes('|'))return null;
 const headers=tableCells(header),rules=tableCells(separator);
 if(headers.length<2||headers.length!==rules.length
  ||!rules.every(rule=>/^:?-{3,}:?$/.test(rule)))return null;
 const align:TableAlign[]=rules.map(rule=>rule.startsWith(':')&&rule.endsWith(':')
  ?'center':rule.endsWith(':')?'right':'left');
 return {headers,align};
}
const horizontalRule=(line:string)=>/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

export const SafeMarkdown=memo(function SafeMarkdown({text,className=''}:{text:string;className?:string}){
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 const nodes:ReactNode[]=[];let i=0;
 while(i<lines.length){
  const l=lines[i];
  if(!l.trim()){i++;continue;}
  const fence=l.match(/^\s*\`\`\`([a-z0-9_-]*)\s*$/i);
  if(fence){
   const code:string[]=[];i++;
   while(i<lines.length&&!/^\s*\`\`\`\s*$/.test(lines[i]))code.push(lines[i++]);
   if(i<lines.length)i++;
   nodes.push(<pre key={nodes.length}><code>{code.join('\n')}</code></pre>);
   continue;
  }
  const table=i+1<lines.length?tableDefinition(lines[i],lines[i+1]):null;
  if(table){
   const body:ReactNode[]=[];i+=2;
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){
    const cells=tableCells(lines[i]);
    if(cells.length!==table.headers.length)break;
    body.push(<tr key={body.length}>{cells.map((cell,index)=><td key={index}
     style={{textAlign:table.align[index]}}>{inline(cell)}</td>)}</tr>);
    i++;
   }
   nodes.push(<div key={nodes.length} className="markdown-table-scroll"><table>
    <thead><tr>{table.headers.map((cell,index)=><th key={index}
     scope="col" style={{textAlign:table.align[index]}}>{inline(cell)}</th>)}</tr></thead>
    <tbody>{body}</tbody>
   </table></div>);
   continue;
  }
  if(horizontalRule(l)){nodes.push(<hr key={nodes.length}/>);i++;continue;}
  const heading=l.match(/^(#{1,4})\s+(.+)$/);
  if(heading){
   const title=inline(heading[2]),key=nodes.length;
   nodes.push(heading[1].length===1?<h2 key={key}>{title}</h2>
    :heading[1].length===2?<h3 key={key}>{title}</h3>
    :<h4 key={key}>{title}</h4>);
   i++;continue;
  }
  const bullet=l.match(/^\s{0,3}([-*+]\s+|\d+\.\s+)(.*)$/);
  if(bullet){
   const ordered=/^\d/.test(bullet[1]);
   const items:ReactNode[]=[];
   while(i<lines.length){
    const found=lines[i].match(/^\s{0,3}([-*+]\s+|\d+\.\s+)(.*)$/);
    if(!found||/^\d/.test(found[1])!==ordered)break;
    items.push(<li key={items.length}>{inline(found[2])}</li>);i++;
   }
   nodes.push(ordered?<ol key={nodes.length}>{items}</ol>:<ul key={nodes.length}>{items}</ul>);
   continue;
  }
  if(/^>\s?/.test(l)){
   const quoted:string[]=[];
   while(i<lines.length&&/^>\s?/.test(lines[i]))quoted.push(lines[i++].replace(/^>\s?/,''));
   nodes.push(<blockquote key={nodes.length}>{inline(quoted.join(' '))}</blockquote>);
   continue;
  }
  // Fallback consumes at least one line, including malformed Markdown.
  const paragraph:string[]=[lines[i++]];
  while(i<lines.length&&lines[i].trim()&&!/^\s*\`\`\`/.test(lines[i])
   &&!/^#{1,4}\s+/.test(lines[i])&&!/^\s{0,3}([-*+]\s+|\d+\.\s+)/.test(lines[i])
   &&!/^>\s?/.test(lines[i])&&!horizontalRule(lines[i])
   &&!(i+1<lines.length&&tableDefinition(lines[i],lines[i+1])))paragraph.push(lines[i++]);
  nodes.push(<p key={nodes.length}>{paragraph.map((line,index)=><Fragment key={index}>
   {index>0?' ':null}{inline(line)}
  </Fragment>)}</p>);
 }
 return <div className={'markdown-result '+className}>{nodes}</div>;
});
