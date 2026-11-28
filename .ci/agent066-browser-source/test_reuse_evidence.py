"""Positive and negative evidence tests without a GitHub token or private code."""
import copy
import json
import os
from pathlib import Path
import struct
import sys
import types
import tempfile
import unittest
from unittest.mock import patch
import admit
import reuse_evidence as e


def good_prior():
    run = {'id':admit.PRIOR_RUN,'run_attempt':admit.PRIOR_ATTEMPT,'workflow_id':e.WORKFLOW_ID,
           'head_sha':e.PRIOR_HEAD,'head_branch':e.PRIOR_BRANCH,'status':'completed','conclusion':'failure',
           'path':'.github/workflows/agent066-browser-source.yml','repository':{'id':e.REPO_ID},'head_repository':{'id':e.REPO_ID}}
    jobs = []
    for name,(ident,conclusion) in e.JOBS.items():
        steps = [{'name':n,'status':'completed','conclusion':c} for n,c in (
            ('Admit exact one-time request before private access','success'),
            ('Grouped verification on temporary private checkout',conclusion),
            ('Preserve encrypted clean-installed candidate','success' if name == 'qualify / desktop' else 'skipped'))]
        jobs.append({'name':name,'id':ident,'status':'completed','conclusion':conclusion,'run_attempt':admit.PRIOR_ATTEMPT,'head_sha':e.PRIOR_HEAD,'steps':steps})
    artifact = {'id':admit.PRIOR_ARTIFACT,'name':e.ARTIFACT_NAME,'size_in_bytes':e.ARTIFACT_SIZE,'digest':e.ARTIFACT_DIGEST,'expired':False,
                'workflow_run':{'id':admit.PRIOR_RUN,'repository_id':e.REPO_ID,'head_repository_id':e.REPO_ID,'head_branch':e.PRIOR_BRANCH,'head_sha':e.PRIOR_HEAD}}
    return run,{'total_count':len(jobs),'jobs':jobs},{'total_count':1,'artifacts':[artifact]}


class Evidence(unittest.TestCase):
    def test_exact_prior(self):
        e.verify_prior(*good_prior())

    def test_reject_bad_prior(self):
        for path,bad in (((0,'head_sha'),'0'*40),((0,'run_attempt'),2),((0,'conclusion'),'success'),((0,'repository','id'),0),
                         ((1,'jobs',0,'conclusion'),'failure'),((1,'jobs',0,'id'),1),((1,'jobs',1,'name'),'qualify / core'),
                         ((1,'jobs',0,'steps',0,'conclusion'),'failure'),((1,'jobs',4,'steps',2,'conclusion'),'skipped'),
                         ((2,'artifacts',0,'expired'),True),((2,'artifacts',0,'digest'),'wrong'),((2,'artifacts',0,'id'),1),
                         ((2,'artifacts',0,'workflow_run','head_sha'),'0'*40),((2,'total_count'),2)):
            with self.subTest(path=path):
                args=good_prior(); row=args
                for part in path[:-1]:row=row[part]
                row[path[-1]]=bad
                with self.assertRaises(ValueError):e.verify_prior(*args)

    def test_exact_witness_tree(self):
        before = {('private/file-'+str(i)).encode():b'100644 blob '+b'a'*40 for i in range(3353)}
        after = before.copy()
        for name,(old,new) in e.WITNESS_CHANGES.items():
            before[name]=('100644 blob '+old).encode();after[name]=('100644 blob '+new).encode()
        e.verify_witness_trees(before,after,[admit.CANDIDATE_PIN])
        for b,a,parents in ((before,{**after,b'private/file-1':b'100644 blob '+b'b'*40},[admit.CANDIDATE_PIN]),
                            (before,{**after,b'extra':b'100644 blob '+b'a'*40},[admit.CANDIDATE_PIN]),
                            (before,before,[admit.CANDIDATE_PIN]),(before,after,['0'*40])):
            with self.assertRaises(ValueError):e.verify_witness_trees(b,a,parents)
        path=next(iter(e.WITNESS_CHANGES))
        with self.assertRaises(ValueError):e.verify_witness_trees(before,{**after,path:after[path].replace(b'100644',b'100755')},[admit.CANDIDATE_PIN])
        self.assertEqual(e.tree_entries(b'100644 blob '+b'a'*40+b'\tpath\0'),{b'path':b'100644 blob '+b'a'*40})
        with self.assertRaises(ValueError):e.tree_entries(b'100644 blob '+b'a'*40+b'\tpath\0'+b'100644 blob '+b'a'*40+b'\tpath\0')

    def test_delivery_reuses_exact_hashes(self):
        header = struct.Struct('>8s40s40sQ32s12s384s')
        name = 'fixture.iwxae'
        def content(plain):
            return header.pack(b'IWXAENC1',admit.CANDIDATE_PIN.encode(),admit.CANDIDATE_TREE.encode(),1,bytes.fromhex(plain),b'a'*12,b'b'*384)
        module = types.SimpleNamespace(NAME=name,HEADER=header,verify_envelope=lambda folder:e.SEALED_SHA)
        with tempfile.TemporaryDirectory() as folder, patch.dict(sys.modules,{'delivery':module}):
            target = Path(folder)/name
            target.write_bytes(content(e.SETUP_SHA))
            e.verify_delivery(folder)
            target.write_bytes(content('0'*64))
            with self.assertRaises(ValueError):e.verify_delivery(folder)
            target.write_bytes(content(e.SETUP_SHA))
            module.verify_envelope=lambda folder:'0'*64
            with self.assertRaises(ValueError):e.verify_delivery(folder)

    def test_one_shot_request_admission(self):
        a,b='a'*40,'b'*40
        ref=admit.PREFIX+b
        env={'GITHUB_REPOSITORY':'Faust-S/Center','GITHUB_EVENT_NAME':'push','GITHUB_REF':ref,'GITHUB_SHA':a,
             'PRIVATE_PIN':admit.CANDIDATE_PIN,'PRIVATE_TREE':admit.CANDIDATE_TREE,'BASELINE_PIN':admit.BASELINE_PIN,'BASELINE_TREE':admit.BASELINE_TREE,
             'WITNESS_PIN':admit.WITNESS_PIN,'WITNESS_TREE':admit.WITNESS_TREE,'QUALIFICATION_GROUP':'upgrade'}
        event={'created':False,'deleted':False,'forced':False,'ref':ref,'before':b,'after':a}
        prepared=admit.expected_request()
        request={**prepared,'workflow':admit.WORKFLOW,'prepared_sha':b}
        def git(*args):
            return {'rev-parse':a,'rev-list':a+' '+b,'diff-tree':'A\t'+admit.REQUEST,'ls-tree':'100644 blob '+a+'\t'+admit.REQUEST}[args[0]]
        def read(path):return prepared if path==admit.PREPARED else request
        with patch.object(admit,'git',git),patch.object(admit,'read_json',read):
            self.assertEqual(admit.admit(env,event),a)
            for key in ('PRIVATE_PIN','PRIVATE_TREE','BASELINE_PIN','BASELINE_TREE','WITNESS_PIN','WITNESS_TREE','QUALIFICATION_GROUP','GITHUB_REF'):
                with self.assertRaises(ValueError):admit.admit({**env,key:'wrong'},event)
            for key in ('created','deleted','forced'):
                with self.assertRaises(ValueError):admit.admit(env,{**event,key:True})
            for key in ('witness','witness_tree','prior_run','prior_attempt','prior_artifact','scope','installed_gui'):
                val=request[key];request[key]='wrong'
                with self.assertRaises(ValueError):admit.admit(env,event)
                request[key]=val


if __name__=='__main__':
    unittest.main()
