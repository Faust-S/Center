import json
import os
import pathlib
import re
import subprocess

ID='wry-upload-probe'
REQUEST='.github/ci-requests/'+ID+'.json'
PROFILE={'wry':'0.57.1','tao':'0.37.2','webview2-com':'0.39.1','modes':['focus-open','focus-enter']}


def verify(branch,head,before,parents,changes,request):
    if not all(re.fullmatch('[0-9a-f]{40}', v) for v in (head,before)):
        raise ValueError('invalid-sha')
    if branch!='ci/once/'+ID+'/'+before or parents!=[head,before]:
        raise ValueError('invalid-parent')
    if changes!=['A\t'+REQUEST]:
        raise ValueError('invalid-diff')
    if request!={'workflow':ID,'prepared_sha':before,'profile':PROFILE,'purpose':'native-file-picker-isolation'}:
        raise ValueError('invalid-request')


def selftest():
    a,b='a'*40,'b'*40
    good=['ci/once/'+ID+'/'+b,a,b,[a,b],['A\t'+REQUEST],{'workflow':ID,'prepared_sha':b,'profile':PROFILE,'purpose':'native-file-picker-isolation'}]
    verify(*good)
    for i,bad in enumerate(['main','bad','c'*40,[a,b,b],['M\t'+REQUEST],{}]):
        x=good.copy();x[i]=bad
        try: verify(*x)
        except ValueError: continue
        raise AssertionError('invalid input accepted')
    print('ADMISSION_SELFTEST_PASS')


def git(*args):
    return subprocess.check_output(['git',*args],text=True).strip()


if __name__=='__main__':
    selftest()
    if os.getenv('GITHUB_ACTIONS')=='true':
        verify(os.environ['GITHUB_REF_NAME'],os.environ['GITHUB_SHA'],os.environ['PREPARED_SHA'],
               git('rev-list','--parents','-n','1','HEAD').split(),
               git('diff-tree','--no-commit-id','--name-status','-r','HEAD').splitlines(),
               json.loads(pathlib.Path(REQUEST).read_text(encoding='utf-8')))
        print('EXACT_ONE_SHOT_REQUEST_ADMITTED')
