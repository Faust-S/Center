"""Run original Setup Core and the exact installed browser witness on disposable runners."""
import json
import os
import sys
from pathlib import Path
from installed_evidence import (clean_result, upgrade_result, lock_ok, clean_setup_diagnostics,
                                MANUAL_GUI_STAGES, preview_dom_diagnostics, navigation_http_diagnostics, guest_observations,
                                browser_flow_diagnostics)
from admit import SCOPE
from release_gate import (SETUP_PIN, verdict, checkout_setup_owner, verify_setup_build,
                          verify_receipt_preflight, build_frozen_baseline, file_sha256,
                          read_json, witness_diagnostics, UPGRADE_FAILURE_CODES, UPGRADE_PHASES)

LOCK = 'desktop/modeling-native/package-lock.json'
NEW_LOCK = '9da7e581c3bd6041b45499a11deb1571e73d77d0'
OLD_LOCK = 'cfdfa5354dfb130047e1132bb58b1a852c5b572b'
NAME = 'IWXA-Private-SetupCore-Candidate.exe'
RECEIPT = 'logs/private-setup-core-build.json'


def build_identity(out, pin, tree, version):
    if not verify_setup_build(out,pin,tree,version):
        return False
    try:
        size=read_json(out/RECEIPT).get('setup_bytes')
        return type(size) is int and size>0 and size==(out/NAME).stat().st_size
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def native_bridge_diagnostics(data):
    outcomes = frozenset(('NOT_OBSERVED','BOUND','READY','UNAVAILABLE','DOWNLOAD_TARGET',
        'CLOSED','SUSPENDED','DENIED','WORKSPACE_POLICY','FILES_RECEIPT','FILES_ROOT',
        'FILES_FOLDER','MCP_BUNDLE','MCP_PROFILE','MCP_ENDPOINT','MCP_BINDING',
        'MCP_SELECTION','MCP_PROTOCOL','CORE_OPERATION'))
    helper = frozenset(('PASS','NATIVE_HELPER','INSTALL_AUTHORITY','CORE_IDENTITY','CORE_REQUEST'))
    result = {}
    for flow in ('MANUAL','SNAPSHOT','FILES','ACTIONS'):
        for operation in ('AUTH','OPEN','ENABLE','RECONCILE','DOWNLOAD','HELPER'):
            name = 'NATIVE_'+flow+'_'+operation
            prefix = 'AGENT066_'+name+'='
            rows = [line[len(prefix):] for line in data.splitlines() if line.startswith(prefix)]
            allowed = helper if operation == 'HELPER' else outcomes
            if len(rows) == 1 and rows[0] in allowed:
                result[name] = rows[0]
    return result


def upgrade_diagnostics(data, *, label_prefix=''):
    phases=(UPGRADE_PHASES-{'INSTALL_064','DRAFT_064'})|{'INSTALL_065','DRAFT_066','NEW_INSTALL_WITNESS'}
    codes=UPGRADE_FAILURE_CODES|{'NEW_INSTALL_WITNESS_INVALID','INSTALLED_BROWSER_BUNDLE_INVALID',
        'INSTALLED_BROWSER_MANUAL_GUI_INPUT_INVALID','INSTALLED_BROWSER_MANUAL_GUI_TIMEOUT',
        'INSTALLED_BROWSER_MANUAL_GUI_RECEIPT_INVALID','INSTALLED_BROWSER_HTTP_EVIDENCE_INVALID',
        'INSTALLED_BROWSER_SNAPSHOT_MODE_FAILED','INSTALLED_BROWSER_SNAPSHOT_GUI_INPUT_INVALID',
        'INSTALLED_BROWSER_SNAPSHOT_GUI_RECEIPT_INVALID','INSTALLED_BROWSER_SNAPSHOT_WINDOW_INVALID',
        'INSTALLED_BROWSER_SNAPSHOT_HTTP_INVALID','INSTALLED_BROWSER_FILES_EVIDENCE_INVALID',
        'INSTALLED_BROWSER_FILES_HTTP_INVALID',
        *('INSTALLED_BROWSER_ACTION_'+s.upper() for s in ('proof_invalid','model_input_invalid','model_failed_execute',
           'model_failed_readback','model_proof_invalid','probe_input_invalid','gui_input_invalid',
           'gui_receipt_invalid','window_invalid','http_invalid')),
        *('INSTALLED_BROWSER_ACTION_PROBE_FAILED_'+s.upper() for s in ('setup','initial','ready','attached','proposed','reviewed','prepared','approved','execute','duplicate','stale','stale-return','cold')),
        *('INSTALLED_BROWSER_ACTION_GUI_FAILED_'+s.upper() for s in ('snapshot-open','snapshot-connect','snapshot-attach','action-submit-task','action-blank','action-review','action-prepare','action-approve','action-approved-blank','action-execute','action-filled','action-change','action-submit-sentinel','action-new-tab','action-original-tab','action-stale-blank','snapshot-close')),
        *('INSTALLED_BROWSER_FILES_PROBE_FAILED_'+s.upper() for s in ('baseline','root','before-read','read','cold')),
        *('INSTALLED_BROWSER_FILES_GUI_FAILED_'+s.upper() for s in ('configure','open','blocked','download','blocked-again','upload','read')),
        *('INSTALLED_BROWSER_SNAPSHOT_PROBE_FAILED_'+s.upper() for s in ('initial','ready','attached','revoked','external','cold')),
        *('INSTALLED_BROWSER_SNAPSHOT_GUI_FAILED_SNAPSHOT-'+s.upper() for s in ('open','connect','attach','t3-on','t3-off','close')),
        *('INSTALLED_BROWSER_MANUAL_GUI_FAILED_'+s.upper() for s in MANUAL_GUI_STAGES)}
    for key,allowed in (('PHASE',phases),('FAILURE_CODE',codes)):
        prefix='AGENT066_UPGRADE_'+key+'='
        matches=[l[len(prefix):] for l in data.splitlines() if l.startswith(prefix)]
        if len(matches)==1 and matches[0] in allowed:
            print(label_prefix+'UPGRADE_WITNESS_'+key+'='+matches[0],flush=True)

    for name,value in {**preview_dom_diagnostics(data), **navigation_http_diagnostics(data), **guest_observations(data), **browser_flow_diagnostics(data,codes), **native_bridge_diagnostics(data)}.items():
        print(label_prefix+name+'='+value,flush=True)


def installed_gate(q, pin, tree, baseline, old_pin, old_tree, *, upgrade=False, witness=None):
    if (os.name!='nt' or upgrade != (baseline is not None)
            or os.environ.get('QUALIFICATION_GROUP')!=('upgrade' if upgrade else 'desktop')
            or (SCOPE == 'B066_WITNESS_ONLY_UPGRADE') != (witness is not None)
            or (witness is not None and (not upgrade or witness is q or witness is baseline
                                         or not witness.results or not all(witness.results.values())))):
        q.block('SETUP_ADMISSION'); return False
    if not verdict(q,'COMMITTED_NATIVE_LOCK_BEFORE',LOCK in q.files and lock_ok(q.src/LOCK,NEW_LOCK,'0.6.6')):
        return False
    if upgrade and not verdict(q,'BASELINE_LOCK_BEFORE',LOCK in baseline.files and lock_ok(baseline.src/LOCK,OLD_LOCK,'0.6.5')):
        return False
    owner=checkout_setup_owner(q)
    if owner is None:
        q.block('SETUP_OWNER');return False
    native_python=q.venv('installedmodelqa',['qualification/modeling-preparation/requirements.txt'])
    if native_python is None:
        q.block('SETUP_RELEASE');return False
    out=q.root/'setup-output'
    env=dict(q.env)
    env['PATH']=str(Path(native_python).parent)+os.pathsep+env.get('PATH','')
    env['IWXA_AGENT065_MODELING_PYTHON']=str(native_python)
    env['IWXA_AGENT06_QUALIFICATION_SCOPE']='PERSONAL_RELEASE'
    env.pop('CARGO_TARGET_DIR',None)
    env.pop('IWXA_AGENT066_DIAGNOSTIC_CONTINUE',None)
    cmd=['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
         '-File',q.src/'tools/build_setup_core_windows_candidate.ps1','-CenterRoot',owner,
         '-CenterCommit',SETUP_PIN,'-ReleaseCacheRoot',q.root/'release-cache','-OutputRoot',out]
    if upgrade:cmd.append('-QualificationBuildOnly')
    label='UPGRADE_CANDIDATE_BUILD' if upgrade else 'SETUP_RELEASE'
    code,data=q.run(label,cmd,env=env,report=False,timeout=7200)
    preflight=verdict(q,'MODELING_RECEIPT_PREFLIGHT',verify_receipt_preflight(out))
    built=verdict(q,'SETUP_BUILT',build_identity(out,pin,tree,'0.6.6'))
    good=False
    if upgrade:
        ready=verdict(q,label,code==0 and preflight and built and data.strip()=='AGENT065_UPGRADE_CANDIDATE_BUILT_UNQUALIFIED')
        # Debug the four independent installed browser routes on the one
        # exact candidate before spending time rebuilding frozen 0.6.5.
        # This is development evidence only; it never replaces upgrade PASS.
        if ready and SCOPE == 'B066_UPGRADE_DIAGNOSTIC':
            root=q.root/'browser-development'
            candidate_hash=file_sha256(out/NAME)
            code,data=q.run('B066_BROWSER_DEVELOPMENT',[sys.executable,q.src/'tools/qualify_setup_core_browser_development.py',
                '--new-setup',out/NAME,'--new-receipt',out/RECEIPT,
                '--qualification-root',root,'--new-source',pin,'--new-tree',tree],env=env,report=False,timeout=6000)
            ready=verdict(q,'B066_BROWSER_DEVELOPMENT',code==0 and data.strip()=='AGENT066_BROWSER_DEVELOPMENT_PASS'
                          and file_sha256(out/NAME)==candidate_hash)
            if not ready:
                upgrade_diagnostics(data,label_prefix='DEVELOPMENT_')
                q.block('UPGRADE_BASELINE_BUILT')
        if ready:
            old_out=build_frozen_baseline(q,baseline,owner,source=old_pin,tree=old_tree,version='0.6.5')
            ready=verdict(q,'UPGRADE_BASELINE_BUILT',old_out is not None and build_identity(old_out,old_pin,old_tree,'0.6.5'))
        if ready:
            if SCOPE == 'B066_UPGRADE_DIAGNOSTIC' or witness is not None:
                # Continue diagnostics after a known browser-route failure, but
                # the original witness still rejects and cannot confirm upgrade.
                env['IWXA_AGENT066_DIAGNOSTIC_CONTINUE']='1'
            root=q.root/'real-upgrade'
            witness_src = witness.src if witness is not None else q.src
            code,data=q.run('UPGRADE_065_TO_066',[sys.executable,witness_src/'tools/qualify_setup_core_upgrade_065_to_066.py',
                '--old-setup',old_out/NAME,'--new-setup',out/NAME,
                '--old-receipt',old_out/RECEIPT,'--new-receipt',out/RECEIPT,
                '--qualification-root',root,'--new-source',pin,'--new-tree',tree],env=env,report=False,timeout=6000)
            try:
                good=(code==0 and data.strip()=='AGENT066_REBUILT_SOURCE_UPGRADE_PASS'
                      and upgrade_result(read_json(root/'upgrade-witness.json'),old_pin,old_tree,pin,tree,
                                         file_sha256(old_out/NAME),file_sha256(out/NAME)))
            except (OSError,ValueError,TypeError,AttributeError):good=False
            verdict(q,'UPGRADE_065_TO_066',good)
            if not good:upgrade_diagnostics(data)
        else:q.block('UPGRADE_065_TO_066')
        verdict(q,'BASELINE_LOCK_AFTER',lock_ok(baseline.src/LOCK,OLD_LOCK,'0.6.5'))
    else:
        try:
            good=code==0 and preflight and built and clean_result(json.loads(data),pin,tree,file_sha256(out/NAME))
        except (OSError,ValueError,TypeError,AttributeError):good=False
        verdict(q,'SETUP_RELEASE',good)
        if not good:
            for name,value in clean_setup_diagnostics(out).items():print(name+'='+value,flush=True)
            for name,value in witness_diagnostics(out).items():print(name+'='+value,flush=True)
    if not good:q.diagnostics(label,data)
    verdict(q,'COMMITTED_NATIVE_LOCK_AFTER',lock_ok(q.src/LOCK,NEW_LOCK,'0.6.6'))
    return (good and all(q.results.values()) and (baseline is None or all(baseline.results.values()))
            and (witness is None or all(witness.results.values())))
