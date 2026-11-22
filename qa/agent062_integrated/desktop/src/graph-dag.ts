/** UI-only DAG shape validation. Graph Runtime remains the execution authority. */
export type DagStep = {node_id:string;node_type:string;depends_on:string[]};
export type DagEdge = {edge_id:string;from:string;to:string;condition:'ALWAYS'};
type Row = Record<string,unknown>;
const allowed=new Set(['DETERMINISTIC_TRANSFORM','MODEL_INVOCATION','AGENT_RUNTIME','TOOL','PARALLEL_FORK','JOIN']);
const validId=(id:string)=>/^[A-Za-z0-9_.-]{1,160}$/.test(id);
const row=(v:unknown):Row|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:null;

export function dagAncestors(steps:DagStep[],nodeId:string):Set<string>{
 const byId=new Map(steps.map(s=>[s.node_id,s]));
 const found=new Set<string>(),pending=[...(byId.get(nodeId)?.depends_on||[])];
 while(pending.length){
  const id=pending.pop()!;
  if(found.has(id))continue;
  found.add(id);
  pending.push(...(byId.get(id)?.depends_on||[]));
 }
 return found;
}

export function dagTopology(steps:DagStep[]):{edges:DagEdge[];entry_node_id:string;stop_node_ids:string[]}{
 if(steps.length<1||steps.length>32)throw Error('graph_node_count_invalid');
 const ids=new Set<string>(),outgoing=new Map<string,string[]>();
 const edges:DagEdge[]=[];
 for(let i=0;i<steps.length;i++){
  const step=steps[i],id=step.node_id;
  if(!validId(id)||ids.has(id)||!allowed.has(step.node_type))throw Error('graph_node_identity_invalid');
  if(!Array.isArray(step.depends_on)||step.depends_on.length>32||new Set(step.depends_on).size!==step.depends_on.length)
   throw Error('graph_dependencies_invalid');
  if(i===0&&step.depends_on.length!==0||i>0&&step.depends_on.length===0)
   throw Error('graph_single_entry_required');
  for(const parent of step.depends_on){
   if(!ids.has(parent))throw Error('graph_dependency_must_precede_step');
   edges.push({edge_id:'e'+(edges.length+1),from:parent,to:id,condition:'ALWAYS'});
   outgoing.get(parent)!.push(id);
  }
  ids.add(id);outgoing.set(id,[]);
 }
 for(const step of steps){
  const children=outgoing.get(step.node_id)!;
  if(step.node_type==='PARALLEL_FORK'){
   if(step.depends_on.length!==1||children.length<2)throw Error('graph_parallel_fork_requires_branches');
  }else if(children.length>1)throw Error('graph_branch_requires_parallel_fork');
  if(step.node_type==='JOIN'&&step.depends_on.length<2)throw Error('graph_join_requires_multiple_branches');
  if(step.node_type!=='JOIN'&&step.depends_on.length>1)throw Error('graph_multiple_parents_require_join');
 }
 const leaves=steps.filter(step=>outgoing.get(step.node_id)!.length===0);
 if(leaves.length!==1||leaves[0].node_id!==steps[steps.length-1].node_id)
  throw Error('graph_single_terminal_required');
 // Prior-node dependencies ensure acyclicity, single root and terminal
 // ensure every branch eventually joins before the final result.
 return {edges,entry_node_id:steps[0].node_id,stop_node_ids:[leaves[0].node_id]};
}

/** Restore by edges, not Graph Runtime's canonical node-id sorting. */
export function savedDagRows(graph:Row):Array<{node:Row;depends_on:string[]}>|null{
 const nodes=Array.isArray(graph.nodes)?graph.nodes.map(row):[];
 const edges=Array.isArray(graph.edges)?graph.edges.map(row):[];
 if(!nodes.length||nodes.length>32||nodes.some(x=>!x)||edges.some(x=>!x))return null;
 const byId=new Map<string,Row>(),parents=new Map<string,string[]>();
 for(const node of nodes as Row[]){
  const id=node.node_id;
  if(typeof id!=='string'||!validId(id)||byId.has(id))return null;
  byId.set(id,node);parents.set(id,[]);
 }
 const usedEdges=new Set<string>(),usedEdgeIds=new Set<string>();
 for(const edge of edges as Row[]){
  const from=edge.from,to=edge.to,identity=String(from)+'\u0000'+String(to),edgeId=edge.edge_id;
  if(typeof from!=='string'||typeof to!=='string'||!byId.has(from)||!byId.has(to)
   ||typeof edgeId!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(edgeId)
   ||edge.condition!=='ALWAYS'||usedEdges.has(identity)||usedEdgeIds.has(edgeId))return null;
  usedEdges.add(identity);usedEdgeIds.add(edgeId);parents.get(to)!.push(from);
 }
 const entry=graph.entry_node_id;
 if(typeof entry!=='string'||!byId.has(entry)||parents.get(entry)!.length)return null;
 const ordered:Array<{node:Row;depends_on:string[]}>=[],seen=new Set<string>();
 while(ordered.length<nodes.length){
  const available=[...byId.keys()].filter(id=>!seen.has(id)&&parents.get(id)!.every(p=>seen.has(p))).sort();
  const id=ordered.length===0?entry:available[0];
  if(!id||!available.includes(id))return null;
  const p=parents.get(id)!;
  ordered.push({node:byId.get(id)!,depends_on:[...p]});seen.add(id);
 }
 try{
  const shape=dagTopology(ordered.map(x=>({node_id:String(x.node.node_id),node_type:String(x.node.node_type),depends_on:x.depends_on})));
  if(shape.edges.length!==edges.length)return null;
  if(!Array.isArray(graph.stop_node_ids)||graph.stop_node_ids.length!==1||graph.stop_node_ids[0]!==shape.stop_node_ids[0])return null;
 }catch{return null}
 return ordered;
}
