import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManagerContext,searchManagerContext,managerAttention}
  from '../src/manager-context.mjs';

const org=(id,name)=>({
 id,name,
 workspaces:[{id:id+'-space',name:'Закупки'}],
 participants:[{id:id+'-person',name:'Анна',roleLabel:'Снабжение',
   credentialState:'NOT_ENROLLED',personalAgentPlan:'PLANNED'}],
 assignments:[{id:id+'-task',title:'Проверить поставщиков',description:'Три цены на оборудование',
   criteria:'Сроки, комплектация',workspaceId:id+'-space',assigneeId:id+'-person',
   reviewerId:null,status:'DRAFT',dueDate:'2026-11-01',atlasRef:null}]
});

test('manager context includes only the current organization and correct source labels',()=>{
 const north=org('north','Северная группа'),south=org('south','Южная группа');
 const rows=buildManagerContext(north);
 assert.equal(rows.length,4);
 assert.ok(searchManagerContext(rows,'Анна')[0].summary.includes('не подтверждённые права'));
 assert.ok(searchManagerContext(rows,'оборудование')[0].kind==='assignment');
 assert.ok(searchManagerContext(rows,'проверить поставщиков').length===1);
 assert.equal(searchManagerContext(rows,'Южная').length,0);
 assert.equal(searchManagerContext(buildManagerContext(south),'Северная').length,0);
 assert.equal(searchManagerContext(rows,'')[0],undefined);
});
test('observed Atlas is read only and is not a grant or a signed result',()=>{
 const rows=buildManagerContext(org('a','Группа'),{mode:'READ_ONLY_USER_SELECTED_FILE',revision:'6',
   projects:[{id:'project-1',name:'Поставка',owner:'',status:'open',workItems:[
     {id:'work-1',title:'Отгрузить',state:'planned',dueDate:'2026-11-22',priority:'normal'}]}]});
 assert.equal(searchManagerContext(rows,'Отгрузить').length,1);
 assert.match(searchManagerContext(rows,'Поставка')[0].source,/копия Atlas/);
 assert.equal(rows.some(row=>/выданы права|Result принят/.test(row.summary)),false);
 assert.equal(buildManagerContext(org('a','Группа')).some(row=>row.kind==='atlas-work'),false);
});
test('attention is honest about draft deadlines and source revision',()=>{
 const north=org('north','Группа');
 let items=managerAttention(north,{today:'2026-11-21'});
 assert.ok(items.some(item=>item.key==='date:north-task'&&item.detail.includes('не подтверждённая просрочка')));
 north.assignments[0].assigneeId=null;
 north.assignments[0].atlasRef={projectId:'project-1',revision:'1'};
 items=managerAttention(north,{today:'2026-11-21',atlasStatus:()=> 'SOURCE_REVISION_CHANGED'});
 assert.ok(items.some(item=>item.key==='assignee:north-task'));
 assert.ok(items.some(item=>item.key==='atlas:north-task'));
 assert.ok(items.every(item=>item.destination==='work'||item.destination==='resources'));
 assert.equal(managerAttention(null).length,0);
});
test('search is Unicode-aware, bounded, token-based and cannot bridge organizations',()=>{
 const north=org('north','Ёлка'),south=org('south','Другая');
 const hits=searchManagerContext(buildManagerContext(north),'елка');
 assert.equal(hits.length,1);
 assert.equal(searchManagerContext(buildManagerContext(south),'елка').length,0);
 assert.deepEqual(searchManagerContext(buildManagerContext(north),'поставщиков несуществующее'),[]);
 assert.deepEqual(searchManagerContext(buildManagerContext(north),'поставщиков',0),[]);
});
