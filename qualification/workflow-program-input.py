"""Disposable source-host integration witness. No production activation."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import traceback

root=Path(sys.argv[1]).resolve()
knowledge=Path(sys.argv[2]).resolve()
node_script=Path(__file__).with_suffix('.mjs')
os.chdir(root)
sys.path.insert(0,str(root))
sys.path.insert(0,str(root/'tests'))

def require(ok, code):
    if not ok: raise AssertionError(code)

def rejects(call, code=None):
    try: call()
    except Exception as exc:
        if code is not None: require(str(exc)==code,'REJECTION_CODE')
        return
    raise AssertionError('EXPECTED_REJECTION_MISSING')

def main():
    from runtime.daily_driver_engine import DailyDriverEngine
    from runtime.u01_composition import add_public_program_profiles
    from runtime.program_workflow_input import prepare_original_program_workflow_task,read_original_program_workflow_result
    from runtime.public_program_task import task_id_for_request
    from runtime.modeling_optimization_u01 import PROGRAM_ID
    from tools.qualify_setup_core_modeling import Surface
    from test_agent067_ortools_allocation import problem
    raw=json.dumps(problem(),ensure_ascii=False,indent=2).replace('\n','\r\n',2)+'\n'
    with tempfile.TemporaryDirectory(prefix='iwxapw-') as folder:
        tmp=Path(folder)
        config=json.loads((root/'config'/'daily-driver.example.json').read_text(encoding='utf-8'))
        config['instance_root']=str(tmp/'instance')
        config['vds_control']['enabled']=False
        add_public_program_profiles(config)
        for p in config['providers']:
            if p['provider_id']==PROGRAM_ID: p['settings']['executable']=str(Path(sys.executable).resolve(strict=True))
        cfg=tmp/'config.json'
        cfg.write_text(json.dumps(config),encoding='utf-8')
        engine=DailyDriverEngine(cfg)
        engine.update_ui_preferences(t3_enabled=False)
        surface=Surface(lambda kind,body:getattr(engine.interaction,kind)(body))
        area=surface.query('public_programs')['workspace_id']
        surface.command('provider_switch',{'slot_id':'workflow_execution','provider_id':PROGRAM_ID},'provider',PROGRAM_ID)
        conn=surface.command('public_program_connect',{'confirmed':True},'provider',PROGRAM_ID)
        require(conn['connected'] is True,'NATIVE_CONNECT')
        epoch=conn['connection_epoch']
        def observe(text,selection=None):
            data={'raw':text,'epoch':epoch}
            if selection is not None: data['selection']=selection
            child=subprocess.run(['node',str(node_script),str(knowledge)],input=json.dumps(data,ensure_ascii=False).encode('utf-8'),
                capture_output=True,check=True,timeout=60)
            return json.loads(child.stdout)
        first=observe(raw)
        selected=first['selection']
        prepared=first['prepared']
        class Port:
            text=raw
            tamper=False
            calls=0
            def currentBinding(self):
                return {'subjectKind':'PERSONAL','sourceWorkspaceId':selected['workspaceId'],
                    'agentWorkspaceId':area,'contextEpoch':'controlled-epoch'}
            def readInputs(self,selection):
                self.calls+=1
                p=observe(self.text,selection)['prepared']
                if self.tamper: p['modelingSource']['text']+=' '
                return p
        port=Port()
        def prepare(request_id,confirmed=True):
            return prepare_original_program_workflow_task(engine,source_owner=port,selection=selected,
                request_id=request_id,confirmed=confirmed)
        request='workflow-allocation-0001'
        bad='workflow-allocation-bad-01'
        rejects(lambda:prepare(bad,False),'u01_workflow_original_owner_required')
        port.tamper=True
        rejects(lambda:prepare(bad),'u01_workflow_asset_bytes_changed')
        port.tamper=False
        require(not (engine.core_root/'tasks'/task_id_for_request(bad)/'task.json').exists(),'BAD_TASK_CREATED')
        args={'request_id':bad,'workspace_id':area,'operation':selected['program']['operation'],
            'parameters':selected['program']['parameters'],'connection_epoch':epoch,'message':prepared['message'],
            'confirmed':True,'modeling_source':prepared['modelingSource'],'verified_workflow':prepared['reference']}
        rejects(lambda:surface.command('public_program_task_draft',args,'provider',PROGRAM_ID))
        require(not (engine.core_root/'tasks'/task_id_for_request(bad)/'task.json').exists(),'PUBLIC_FORGERY_CREATED')
        draft=prepare(request)
        require(draft['state']=='READY_FOR_REVIEW' and not draft['execution_performed'] and not draft['model_invoked'],'ORIGINAL_TASK_PREPARATION')
        task,candidate=draft['task_id'],draft['candidate_id']
        repeat=prepare(request)
        require(repeat['task_id']==task and repeat['reused'] is True,'IDENTICAL_REQUEST')
        port.text=raw+' '
        rejects(lambda:prepare(request),'u01_request_identity_conflict')
        port.text=raw
        print('WORKFLOW_ORIGINAL_TASK_INPUT_PASS',flush=True)
        surface.command('review_task',{'action':'accept','accept_action_candidates':[candidate]},'task',task)
        plan=surface.command('tool_prepare',{'task_id':task},'action_candidate',candidate)
        approval=surface.command('tool_approve',{'decision':'approve'},'tool_plan',plan['plan_id'])
        done=surface.command('tool_execute',{'approval_id':approval['approval_id']},'tool_plan',plan['plan_id'])
        receipt=done['receipt']
        require(receipt['status']=='SUCCEEDED' and receipt['provider_id']==PROGRAM_ID,'NATIVE_EXECUTION')
        rid=receipt['receipt_id']
        def read(e,digest=prepared['candidateDigest'],tid=task):
            return read_original_program_workflow_result(e,workspace_id=area,task_id=tid,receipt_id=rid,expected_candidate_digest=digest)
        result=read(engine)
        require(result['reference']==prepared['reference'] and result['declaredInputBindingVerified'] and result['outputVerified'],'ORIGINAL_RESULT_BINDING')
        require(not any(result[k] for k in ('workCompleted','finalHumanAcceptanceProven','resultReuseProven','executionPerformed','executionAuthority')),'PREMATURE_ACCEPTANCE')
        doc=json.loads(result['output'])
        require(doc['files'][0]['text']==raw,'ASSET_EXACT_BYTES')
        require(json.loads(doc['files'][1]['text'])['objective']==11,'OPTIMAL_VALUE')
        require(result['reference']['source']['sha256']==hashlib.sha256(raw.encode()).hexdigest(),'ASSET_HASH')
        rejects(lambda:read(engine,'0'*64),'u01_workflow_result_work_changed')
        rejects(lambda:read(engine,tid='TASK-U01-other'),'u01_workflow_result_task_changed')
        print('WORKFLOW_APPROVED_REAL_ALLOCATION_PASS',flush=True)
        restarted=DailyDriverEngine(cfg)
        require(read(restarted)==result,'COLD_ORIGINAL_RESULT')
        print('WORKFLOW_COLD_RESULT_PASS',flush=True)
        print('WORKFLOW_ORIGINAL_PROGRAM_CHAIN_PASS',flush=True)

if __name__=='__main__':
    main()
