"""Final four original Workflow Works through QGIS, two Valhalla profiles,
and OR-Tools. Public controlled map, real Agent owner and native programs.
Source-owner and signed context ports remain disposable qualification fixtures.
"""
import copy
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root=Path(sys.argv[1]).resolve()
knowledge=Path(sys.argv[2]).resolve()
pbf=Path(sys.argv[3]).resolve(strict=True)
node_script=Path(__file__).with_suffix('.mjs').resolve()
os.chdir(root)
sys.path.insert(0,str(root))
sys.path.insert(0,str(root/'tests'))


def require(ok, code):
    if not ok: raise AssertionError(code)


def rejects(call, code=None):
    try: call()
    except Exception as exc:
        if code is not None: require(str(exc)==code,'WORKFLOW_REJECTION_CODE')
        return
    raise AssertionError('WORKFLOW_EXPECTED_REJECTION_MISSING')


def main():
    from runtime import personal_agent as core
    from runtime.daily_driver_engine import DailyDriverEngine
    from runtime.storage_authority import write_authority
    from runtime.u01_composition import add_public_program_profiles
    from runtime.professional_install import professional_target
    from runtime.modeling_optimization_u01 import SPATIAL_ID,ROAD_ID,PROGRAM_ID
    from runtime.program_workflow_input import prepare_original_program_workflow_task,read_original_program_workflow_result
    from runtime.public_program_task import task_id_for_request
    from tools.qualify_setup_core_modeling import Surface
    from test_agent067_professional_install import _build_native_valhalla_graph
    from test_agent067_valhalla_road_table import problem,SMALL,LARGE
    from test_agent067_valhalla_fleet_input import delivery
    from adapters.modeling import qgis_point_projection as qgis
    require(os.name=='nt','WORKFLOW_WINDOWS_REQUIRED')
    os.environ.pop('IWXA_LOCAL_ONLY',None)
    with tempfile.TemporaryDirectory(prefix='iwxawd-') as folder:
        tmp=Path(folder)
        roots={k:str(tmp/name) for k,name in (('data_root','d'),('software_root','s'),('models_root','m'),('cache_root','c'),('local_root','l'))}
        authority=tmp/'authority.json'
        write_authority(authority,roots,install_root=root,profile_id='QUALIFICATION')
        os.environ['IWXA_STORAGE_AUTHORITY']=str(authority)
        config=json.loads((root/'config/daily-driver.example.json').read_text(encoding='utf-8'))
        config['instance_root']=roots['data_root'];config['vds_control']['enabled']=False
        add_public_program_profiles(config)
        cfg=tmp/'agent.json';cfg.write_text(json.dumps(config),encoding='utf-8')
        engine=DailyDriverEngine(cfg);engine.update_ui_preferences(t3_enabled=False)
        surface=Surface(lambda kind,body:getattr(engine.interaction,kind)(body))
        installed={}
        for provider in (SPATIAL_ID,ROAD_ID,PROGRAM_ID):
            plan=surface.query('program_install_plan',{'program_id':provider,'operation':'INSTALL'})
            require(plan['ready'] and not plan['provider_activated'],'WORKFLOW_INSTALL_PLAN')
            ack=surface.command('program_install_apply',{'program_id':provider,'operation':'INSTALL',
                'plan_digest':plan['plan_digest'],'confirmed':True,'accept_terms':True},'program',provider)
            worker=engine.program_installer._worker;worker.join(timeout=1800 if provider==SPATIAL_ID else 950)
            require(not worker.is_alive(),'WORKFLOW_INSTALL_TIMEOUT')
            receipt=next(r for r in engine.program_installer.snapshot()['receipts'] if r['receipt_id']==ack['receipt_id'])
            require(receipt['status']=='INSTALLED_DETECTED' and receipt['native_probe_passed'],'WORKFLOW_NATIVE_INSTALL')
            installed[provider]=receipt['installed_executable']
        graph=_build_native_valhalla_graph(tmp,professional_target(Path(roots['software_root']),ROAD_ID),installed[ROAD_ID],pbf)
        os.environ['IWXA_VALHALLA_CONFIG']=str(graph)
        os.environ['IWXA_VALHALLA_EXECUTABLE']=installed[ROAD_ID]
        os.environ['IWXA_QGIS_PYTHON']=installed[SPATIAL_ID]
        os.environ['IWXA_ORTOOLS_PYTHON']=installed[PROGRAM_ID]
        engine=DailyDriverEngine(cfg);engine.update_ui_preferences(t3_enabled=False)
        surface=Surface(lambda kind,body:getattr(engine.interaction,kind)(body))
        area=surface.query('public_programs')['workspace_id']
        print('WORKFLOW_MANAGED_THREE_ENGINE_INSTALL_PASS',flush=True)
        qgis_text=json.dumps({'schema':qgis.PROBLEM_SCHEMA,'crs':'EPSG:4326',
            'points':[{'id':'D','x':10.001,'y':40.0},{'id':'A','x':10.009,'y':40.0}]},indent=2).replace('\n','\r\n')+'\n'
        def connect(provider):
            surface.command('provider_switch',{'slot_id':'workflow_execution','provider_id':provider},'provider',provider)
            conn=surface.command('public_program_connect',{'confirmed':True},'provider',provider)
            require(conn['connected'] is True,'WORKFLOW_NATIVE_CONNECT')
            return conn['connection_epoch']
        def observe(payload,selection=None):
            data=copy.deepcopy(payload)
            if selection is not None:data['selection']=selection
            child=subprocess.run(['node',str(node_script),str(knowledge)],input=json.dumps(data,ensure_ascii=False).encode('utf-8'),
                capture_output=True,check=True,timeout=90)
            return json.loads(child.stdout)
        class Port:
            def __init__(self,payload,selection):
                self.payload=payload;self.selection=selection;self.tamper=False
            def currentBinding(self):
                return {'subjectKind':'PERSONAL','sourceWorkspaceId':self.selection['workspaceId'],
                        'agentWorkspaceId':area,'contextEpoch':'controlled-road-epoch'}
            def readInputs(self,selection):
                actual=observe(self.payload,selection)['prepared']
                if self.tamper:
                    actual['reference']['predecessorResults'][0]['outputDigest']='0'*64
                    actual['candidateDigest']=core.digest_obj(actual['reference'])
                return actual
        def make(payload):
            selected=observe(payload)
            return selected,Port(payload,selected['selection'])
        def prepare(port,request):
            return prepare_original_program_workflow_task(engine,source_owner=port,selection=port.selection,request_id=request,confirmed=True)
        def execute(draft,provider):
            require(draft['state']=='READY_FOR_REVIEW' and not draft['execution_performed'],'WORKFLOW_ORIGINAL_PREPARATION')
            task,candidate=draft['task_id'],draft['candidate_id']
            surface.command('review_task',{'action':'accept','accept_action_candidates':[candidate]},'task',task)
            plan=surface.command('tool_prepare',{'task_id':task},'action_candidate',candidate)
            approval=surface.command('tool_approve',{'decision':'approve'},'tool_plan',plan['plan_id'])
            receipt=surface.command('tool_execute',{'approval_id':approval['approval_id']},'tool_plan',plan['plan_id'])['receipt']
            require(receipt['status']=='SUCCEEDED' and receipt['provider_id']==provider,'WORKFLOW_NATIVE_EXECUTION')
            return receipt
        root_payload={'qgisText':qgis_text,'step':'points','specification':{'target_crs':'EPSG:32632'},'epoch':connect(SPATIAL_ID)}
        root_input,root_port=make(root_payload)
        root_task=prepare(root_port,'workflow-road-qgis-root-01')
        root_receipt=execute(root_task,SPATIAL_ID)
        def read(e,draft,receipt,prepared):
            return read_original_program_workflow_result(e,workspace_id=area,task_id=draft['task_id'],
                receipt_id=receipt['receipt_id'],expected_candidate_digest=prepared['candidateDigest'])
        prior=read(engine,root_task,root_receipt,root_input['prepared'])
        require(prior['reference']==root_input['prepared']['reference'] and prior['outputVerified'],'WORKFLOW_ROOT_RESULT')
        print('WORKFLOW_ORIGINAL_QGIS_ROOT_PASS',flush=True)
        epoch=connect(ROAD_ID)
        graph_preview=surface.query('public_valhalla_graph_preview',{'workspace_id':area,'config_path':str(graph)})
        raw_problem=problem(graph_preview['graph'])
        identity={'workspace_id':area,'task_id':prior['taskId'],'receipt_id':prior['receiptId'],'output_digest':prior['outputDigest']}
        points=surface.query('public_valhalla_spatial_preview',{'workspace_id':area,'selection':identity})
        raw_problem['points']=points['points']
        road_text=json.dumps(raw_problem,ensure_ascii=False,indent=2).replace('\n','\r\n')+'\n'
        roads=[]
        for step,spec,metres,seconds in (('small',SMALL,683,61),('large',LARGE,1573,152)):
            payload={'qgisText':qgis_text,'roadText':road_text,'step':step,'specification':spec,
                     'epoch':epoch,'priorResults':[prior]}
            selected,port=make(payload)
            reference=selected['prepared']['reference']
            require(reference['predecessorResults'][0]['workRef']==prior['reference']['workRef'],'WORKFLOW_CANONICAL_PREDECESSOR')
            task=prepare(port,'workflow-native-road-'+step+'-01')
            receipt=execute(task,ROAD_ID)
            result=read(engine,task,receipt,selected['prepared'])
            require(result['reference']==reference and result['declaredInputBindingVerified'] and result['outputVerified'],'WORKFLOW_NATIVE_ROAD_BINDING')
            doc=json.loads(result['output']);projected=json.loads(doc['files'][0]['text']);matrix=json.loads(doc['files'][1]['text'])
            require(projected['spatial_source']['source']==identity and projected['points']==raw_problem['points'],'WORKFLOW_ACTUAL_QGIS_PROJECTION')
            require(reference['source']['sha256']==hashlib.sha256(road_text.encode('utf-8')).hexdigest() and
                reference['source']['sha256']!=doc['files'][0]['reference']['sha256'],'WORKFLOW_DISTINCT_ROAD_BYTES')
            require(matrix['reachable_count']==2 and Fraction(matrix['matrix'][0]['metres'])==metres and
                Fraction(matrix['matrix'][0]['seconds'])==seconds,'WORKFLOW_REAL_ROAD_MATRIX')
            roads.append((task,receipt,selected['prepared'],result))
            print('WORKFLOW_APPROVED_REAL_'+step.upper()+'_VALHALLA_PASS',flush=True)
        epoch=connect(PROGRAM_ID)
        fleet_text=json.dumps(delivery(),ensure_ascii=False,indent=2).replace('\n','\r\n')+'\n'
        assignments=[{'vehicleId':step,'stepId':step,'tariff':{'cost_unit':'kopecks','per_kilometre':1000,'per_hour':0}}
                     for step in ('small','large')]
        payload={'qgisText':qgis_text,'roadText':road_text,'fleetText':fleet_text,'step':'route',
            'specification':{'time_limit_seconds':5},'epoch':epoch,'priorResults':[prior,*[row[3] for row in roads]],
            'fleetAssignments':assignments}
        target_input,target_port=make(payload)
        reference=target_input['prepared']['reference']
        require([p['workRef'] for p in reference['predecessorResults']]==[r[3]['reference']['workRef'] for r in roads],
                'WORKFLOW_EXACT_FLEET_PREDECESSORS')
        require(reference['fleetAssignments']==assignments,'WORKFLOW_EXACT_FLEET_ASSIGNMENTS')
        try:
            observe({**payload,'qgisText':qgis_text+' '})
        except subprocess.CalledProcessError as exc:
            require(b'METHOD_PROGRAM_PREDECESSOR_INPUT_CHANGED' in exc.stderr,'WORKFLOW_CHANGED_ANCESTOR_REFUSAL')
        else:
            raise AssertionError('WORKFLOW_CHANGED_ANCESTOR_ACCEPTED')
        target_port.tamper=True
        bad='workflow-fleet-forged-prior-01'
        rejects(lambda:prepare(target_port,bad),'u01_workflow_predecessor_result_changed')
        require(not (engine.core_root/'tasks'/task_id_for_request(bad)/'task.json').exists(),'WORKFLOW_FORGED_TASK_CREATED')
        target_port.tamper=False
        request='workflow-native-fleet-target-01'
        target_task=prepare(target_port,request)
        repeat=prepare(target_port,request)
        require(repeat['task_id']==target_task['task_id'] and repeat['reused'] is True,'WORKFLOW_IDEMPOTENT_REQUEST')
        changed=copy.deepcopy(payload);changed['fleetAssignments'][0]['tariff']['per_kilometre']=1001
        _,changed_port=make(changed)
        rejects(lambda:prepare(changed_port,request),'u01_request_identity_conflict')
        print('WORKFLOW_ORIGINAL_FLEET_TASK_PASS',flush=True)
        target_receipt=execute(target_task,PROGRAM_ID)
        result=read(engine,target_task,target_receipt,target_input['prepared'])
        require(result['reference']==reference and result['declaredInputBindingVerified'] and result['outputVerified'],'WORKFLOW_NATIVE_FLEET_BINDING')
        require(not any(result[k] for k in ('workCompleted','finalHumanAcceptanceProven','resultReuseProven','executionPerformed','executionAuthority')),'WORKFLOW_PREMATURE_ACCEPTANCE')
        doc=json.loads(result['output']);fleet_problem=json.loads(doc['files'][0]['text']);optimized=json.loads(doc['files'][1]['text'])
        require([r['source']['receipt_id'] for r in fleet_problem['fleet_road_sources']]==[r[1]['receipt_id'] for r in roads],
                'WORKFLOW_ORIGINAL_ROAD_RECEIPTS')
        require(all(json.loads(r['problem_text'])['spatial_source']['source']==identity for r in fleet_problem['fleet_road_sources']),
                'WORKFLOW_SHARED_ORIGINAL_QGIS_LINEAGE')
        require(reference['source']['sha256']==hashlib.sha256(fleet_text.encode('utf-8')).hexdigest() and
                reference['source']['sha256']!=doc['files'][0]['reference']['sha256'],'WORKFLOW_DISTINCT_FLEET_BYTES')
        require(optimized['objective']==1366 and [r['order_ids'] for r in optimized['routes']]==[['A'],[]],
                'WORKFLOW_REAL_FLEET_OPTIMUM')
        print('WORKFLOW_APPROVED_REAL_FLEET_ORTOOLS_PASS',flush=True)
        restarted=DailyDriverEngine(cfg)
        require(read(restarted,root_task,root_receipt,root_input['prepared'])==prior,'WORKFLOW_COLD_ROOT_RESULT')
        for task,receipt,prepared,expected in roads:
            require(read(restarted,task,receipt,prepared)==expected,'WORKFLOW_COLD_ROAD_RESULT')
        require(read(restarted,target_task,target_receipt,target_input['prepared'])==result,'WORKFLOW_COLD_FLEET_RESULT')
        print('WORKFLOW_COLD_FOUR_WORK_RESULTS_PASS',flush=True)

if __name__=='__main__':
    main()
