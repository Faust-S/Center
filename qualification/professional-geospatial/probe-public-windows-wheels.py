"""Public upstream packages only. No IWXA source, secret, user data or private checkout."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile
import json, os, shutil, subprocess, sys, urllib.request

root=Path(os.environ['RUNNER_TEMP'])/'public-engine-probes'
root.mkdir()
sources={
    'python.zip':('https://www.python.org/ftp/python/3.13.15/python-3.13.15-embed-amd64.zip','d1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf'),
    'pip.whl':('https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl','71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e'),
}
wheels={
    'ortools':'https://files.pythonhosted.org/packages/d9/ad/93c05084eec710c38bc952a19002aac31d4c26bb6f8fcbf1057ccc55254b/ortools-9.14.6206-cp313-cp313-win_amd64.whl#sha256=47b1b15dcb085d32c61621b790259193aefa9e4577abadf233d47fbe7d0b81ef',
    'valhalla':'https://files.pythonhosted.org/packages/6c/7b/6cc1cff50d81193ec729fdc40dc7b0374557ddbf835a83340c61d31a651b/pyvalhalla-3.8.2-cp312-abi3-win_amd64.whl#sha256=739532f7e38954a7248d2687a17d6a6a5267b0b2fb0aad93bc672f960bd84c23',
}
for name,(url,digest) in sources.items():
    data=urllib.request.urlopen(url,timeout=120).read()
    assert sha256(data).hexdigest()==digest
    (root/name).write_bytes(data)

def execute(label,args,env=None,cwd=None,timeout=120):
    try:
        p=subprocess.run(list(map(str,args)),env=env,cwd=cwd,capture_output=True,text=True,errors='replace',timeout=timeout)
    except (OSError,subprocess.TimeoutExpired) as e:
        print(label,'LAUNCH_EXCEPTION',type(e).__name__,str(e)[:500],flush=True)
        return None
    print(label,'EXIT',p.returncode,hex(p.returncode & 0xffffffff),flush=True)
    print(label,'STDOUT',p.stdout[-2500:],flush=True)
    print(label,'STDERR',p.stderr[-2500:],flush=True)
    return p

for name,wheel in wheels.items():
    home=root/name
    home.mkdir()
    with ZipFile(root/'python.zip') as z:z.extractall(home)
    site=home/'Lib'/'site-packages'
    site.mkdir(parents=True)
    with ZipFile(root/'pip.whl') as z:z.extractall(site)
    (home/'python313._pth').write_text('python313.zip\n.\nLib\\site-packages\nimport site\n',encoding='ascii')
    exe=home/'python.exe'
    env={k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','SYSTEMDRIVE','COMSPEC','PATH','PATHEXT','PROGRAMFILES','PROGRAMW6432','PROGRAMFILES(X86)','PROGRAMDATA','LOCALAPPDATA','APPDATA','USERPROFILE','TEMP','TMP','PSMODULEPATH'}}
    env.update(PIP_CONFIG_FILE=os.devnull,PYTHONNOUSERSITE='1')
    report=home/'report.json'
    p=execute(name+'_PIP',[exe,'-I','-m','pip','--isolated','--disable-pip-version-check','install','--no-input','--no-cache-dir','--only-binary=:all:','--index-url','https://pypi.org/simple','--report',report,wheel],env=env,cwd=home,timeout=600)
    if not p or p.returncode:continue
    print(name,'DEPENDENCIES',[(x['metadata']['name'],x['metadata']['version']) for x in json.loads(report.read_bytes())['install']],flush=True)
    execute(name+'_CHECK',[exe,'-I','-m','pip','--isolated','check'],env=env,cwd=home)
    if name=='ortools':
        check="from importlib.metadata import version;from ortools.sat.python import cp_model;assert version('ortools')=='9.14.6206';m=cp_model.CpModel();x=m.new_int_var(0,7,'x');m.maximize(x);s=cp_model.CpSolver();assert s.solve(m)==cp_model.OPTIMAL and s.value(x)==7;print('ORIGINAL_SOLVER_OK')"
        execute('ORTOOLS_EMBED_NATIVE',[exe,'-I','-c',check],env=env,cwd=home)
        execute('ORTOOLS_PREFIX',[exe,'-I','-c','import sys,sysconfig;print(sys.version,sys.prefix,sys.path,sysconfig.get_platform())'],env=env,cwd=home)
        execute('ORTOOLS_IMPORTS',[exe,'-I','-c','import numpy;print(numpy.__version__);import pandas;print(pandas.__version__);import ortools;print(ortools.__version__)'],env=env,cwd=home)
        # Exact upstream DLL directory; test child-local dependency loader only.
        execute('ORTOOLS_WITH_DLL_DIRECTORY',[exe,'-I','-c',"import os,sys;from pathlib import Path;d=os.add_dll_directory(str(Path(sys.prefix)/'Lib/site-packages/ortools/.libs'));"+check],env=env,cwd=home)
    else:
        bins=site/'valhalla'/'bin'
        libs=site/'pyvalhalla.libs'
        svc=bins/'valhalla_service.exe'
        print('VALHALLA_PUBLIC_BIN_NAMES',sorted(p.name for p in bins.iterdir()),flush=True)
        print('VALHALLA_PUBLIC_LIB_NAMES',sorted(p.name for p in libs.iterdir()),flush=True)
        execute('VALHALLA_BINDING',[exe,'-I','-c','import valhalla;from valhalla._valhalla import VALHALLA_PRINT_VERSION;print(valhalla.__version__,VALHALLA_PRINT_VERSION)'],env=env,cwd=home)
        execute('VALHALLA_VENDOR_PATH',[svc,'--version'],env={'PATH':str(libs)},cwd=home)
        for p in libs.glob('*.dll'):
            dst=bins/p.name
            if not dst.exists():shutil.copy2(p,dst)
        execute('VALHALLA_ADJACENT_DLLS',[svc,'--version'],env=env,cwd=home)
        execute('VALHALLA_BUILDER',[bins/'valhalla_build_tiles.exe','--version'],env=env,cwd=home)
