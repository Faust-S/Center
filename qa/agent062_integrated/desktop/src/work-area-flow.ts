/**
 * Human-facing work area transitions use the existing Core catalog. No
 * second owner, browser persistence or implicit access authority.
 */
type Row=Record<string,unknown>;
export type AreaPort={
 query<T>(name:string,params?:Record<string,unknown>):Promise<T>;
 command<T>(name:string,input:Record<string,unknown>):Promise<T>;
 refreshRevision?:()=>Promise<void>;
};
const record=(value:unknown):Row=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const name=(value:unknown)=>typeof value==='string'?value:'';
const validId=(id:string)=>id==='personal'||/^AREA-[a-z0-9_-]{1,80}$/i.test(id);

export async function readWorkAreas(port:AreaPort):Promise<Row>{
 const catalog=record(await port.query<Row>('work_areas'));
 const rows=catalog.areas;
 if(typeof catalog.active_id!=='string'||!validId(catalog.active_id)
    ||!Array.isArray(rows)||!rows.some(row=>record(row).id===catalog.active_id)
    ||typeof catalog.catalog_digest!=='string'||!catalog.catalog_digest){
  throw new Error('work_area_catalog_readback_invalid');
 }
 return catalog;
}

export async function selectWorkArea(
 port:AreaPort,id:string,beforeSwitch?:()=>Promise<void>
):Promise<Row>{
 if(!validId(id))throw new Error('work_area_selection_invalid');
 // A failed editor flush must abort BEFORE any Core workspace mutation.
 await beforeSwitch?.();
 await port.refreshRevision?.();
 const response=record(await port.command<Row>('work_area_select',{area_id:id}));
 if(response.active_id!==id||record(response.area).id!==id){
  throw new Error('work_area_selection_not_confirmed');
 }
 const catalog=await readWorkAreas(port);
 if(catalog.active_id!==id)throw new Error('work_area_selection_readback_mismatch');
 return catalog;
}

export async function createAndSelectWorkArea(
 port:AreaPort,input:{name:string;purpose:string;local_only:boolean;
 permissions:{memory:boolean;obsidian:boolean;web:boolean;selected_notes:boolean}},
 beforeSwitch?:()=>Promise<void>
):Promise<Row>{
 if(!input.name.trim()||input.name.length>90)
  throw new Error('work_area_name_invalid');
 // Creation automatically selects its new Workspace. Never create it if
 // unsaved Task/Document/Dialogue state could be abandoned.
 await beforeSwitch?.();
 await port.refreshRevision?.();
 const created=record(await port.command<Row>('work_area_create',input));
 const id=name(record(created.area).id);
 if(!validId(id)||id==='personal')throw new Error('work_area_creation_outcome_unknown');
 const catalog=await readWorkAreas(port);
 if(!(catalog.areas as unknown[]).some(item=>record(item).id===id)){
  throw new Error('work_area_creation_readback_mismatch');
 }
 // Creation remains durable even if selection is interrupted. Never repeat
 // the creation request automatically on a transport or readback failure.
 return selectWorkArea(port,id);
}

/** Read the selected Workspace and its Tasks as one verified projection.
 * A switch during the independent HTTP reads must never show another area's
 * Tasks under a newer active Workspace. No mutation or browser cache is used.
 */
export async function readActiveWorkAreaTasks<T>(
 port:AreaPort,limit=100,knownAreaId?:string
):Promise<{catalog:Row;tasks:T[]}>{
 // When React already has an admitted active Workspace, one read-only
 // Task query and one final catalog suffice; cold startup still reads Core.
 const initial=knownAreaId?null:await readWorkAreas(port);
 const areaId=knownAreaId||name(initial?.active_id);
 if(!validId(areaId))throw Error('work_area_catalog_readback_invalid');
 const result=record(await port.query<Row>('work_area_tasks',{area_id:areaId,limit}));
 if(result.area_id!==areaId||!Array.isArray(result.tasks))
  throw Error('work_area_tasks_readback_mismatch');
 const verified=await readWorkAreas(port);
 if(verified.active_id!==areaId)
  throw Error('work_area_context_changed_during_readback');
 return {catalog:verified,tasks:result.tasks as T[]};
}


/** UI-only admission for a Task opened from any section. A global Task
 * identifier is not proof that it belongs to the selected Workspace.
 * All queries are read-only; no model, review or file write is dispatched.
 */
export async function readTaskInActiveWorkArea<T extends {task_id:string}>(
 port:AreaPort,taskId:string,knownAreaId?:string
):Promise<{catalog:Row;task:T}>{
 if(!/^TASK-[A-Za-z0-9_-]{1,80}$/.test(taskId))
  throw Error('work_area_task_id_invalid');
 const initial=knownAreaId?null:await readWorkAreas(port);
 const areaId=knownAreaId||name(initial?.active_id);
 if(!validId(areaId))throw Error('work_area_catalog_readback_invalid');
 // Membership and task details are independent read-only queries. Running
 // them together cuts one serial network wait; the final catalog still
 // establishes the current Workspace before displaying the Task.
 const [scopedRaw,detailRaw]=await Promise.all([
  port.query<Row>('work_area_tasks',{area_id:areaId,task_id:taskId}),
  port.query<Row>('task',{task_id:taskId}),
 ]);
 const scoped=record(scopedRaw);
 const tasks=scoped.tasks;
 if(scoped.area_id!==areaId||scoped.read_only!==true||
    !Array.isArray(tasks)||tasks.length!==1||record(tasks[0]).id!==taskId)
  throw Error('work_area_task_not_in_active_workspace');
 const detail=record(detailRaw);
 if(detail.task_id!==taskId)throw Error('work_area_task_identity_mismatch');
 const current=await readWorkAreas(port);
 if(current.active_id!==areaId)
  throw Error('work_area_context_changed_during_task_readback');
 return {catalog:current,task:detail as unknown as T};
}

/** A source attachment read is useful only in the Workspace where its Task
 * was selected. A Core response may arrive after the user switches areas.
 * This read-only adapter verifies the exact source and the final Core area
 * before exposing text; it cannot authorize any document or tool mutation.
 */
export async function readDocumentSourceInActiveWorkArea(
 port:AreaPort,request:{areaId:string;taskId:string;snapshotId:string;path:string;sha256:string}
):Promise<Row>{
 const {areaId,taskId,snapshotId,path,sha256}=request;
 if(!validId(areaId)||!/^TASK-[A-Za-z0-9_-]{1,80}$/.test(taskId)
    ||!/^CSN-[A-Za-z0-9_-]+$/.test(snapshotId)
    ||!/^attachments\/[0-9]{2}-[\w.-]{1,120}$/.test(path)
    ||!/^[0-9a-f]{64}$/.test(sha256))
  throw Error('document_source_request_invalid');
 const observed=record(await port.query<Row>('task_document_source',{
  task_id:taskId,snapshot_id:snapshotId,path,expected_sha256:sha256
 }));
 const catalog=await readWorkAreas(port);
 if(catalog.active_id!==areaId||observed.task_id!==taskId
    ||observed.snapshot_id!==snapshotId||observed.path!==path
    ||observed.sha256!==sha256||typeof observed.text!=='string')
  throw Error('document_source_readback_context_changed');
 return observed;
}
