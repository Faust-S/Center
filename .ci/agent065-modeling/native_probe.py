"""Run inside the exact native test interpreter. Publish only fixed markers."""
import hashlib
import importlib
from importlib.metadata import version
from tempfile import TemporaryDirectory

PINS = {'mesa':'3.5.2','simpy':'4.1.2','r4pm':'0.6.2','solara':'1.66.3',
        'solara-ui':'1.66.3','solara-server':'1.66.3','solara-assets2':'1.1.0'}
STAGES = ('PINS','ENVIRONMENT','MESA','SIMPY','R4PM','SOLARA','OFFLINE_VIEW')
PUBLIC_MISSING = frozenset(('mesa','simpy','r4pm','solara','solara.server','mesa.visualization',
    'matplotlib','altair','seaborn','numpy','pandas','ipywidgets','ipyvue','ipyvuetify',
    'uvicorn','starlette','fastapi','websockets','reacton','jinja2','pydantic','pyarrow',
    'scipy','tornado','markdown','filelock','watchdog','nbformat','ipykernel',
    'jupyter_client','humanize','networkx','PIL','anyio','traitlets','packaging'))
ERRORS = ('ModuleNotFoundError','ImportError','AssertionError','ValueError','TypeError',
          'RuntimeError','OSError','PermissionError','FileNotFoundError','KeyError','AttributeError')


def stage(name, operation):
    try:
        operation()
    except Exception as exc:
        error = type(exc).__name__
        print('IWXA_NATIVE_STAGE='+name+':FAIL:'+(error if error in ERRORS else 'Other'),flush=True)
        if isinstance(exc, ModuleNotFoundError) and isinstance(exc.name,str):
            if exc.name in PUBLIC_MISSING:
                print('IWXA_NATIVE_MISSING='+exc.name,flush=True)
            else:
                print('IWXA_NATIVE_MISSING_SHA256='+hashlib.sha256(exc.name.encode('utf-8')).hexdigest(),flush=True)
        return False
    print('IWXA_NATIVE_STAGE='+name+':PASS:None',flush=True)
    return True


def check_pins():
    if not all(version(k)==v for k,v in PINS.items()):
        raise ValueError('native_version_mismatch')


def environment(scratch):
    from adapters.modeling.mesa_live_dependencies import prepare_native_environment
    prepare_native_environment(scratch)


def offline_view(scratch):
    from adapters.modeling.mesa_live_dependencies import require_native_dependencies
    require_native_dependencies(scratch)


def main():
    with TemporaryDirectory() as scratch:
        results=[stage('PINS',check_pins),stage('ENVIRONMENT',lambda:environment(scratch))]
        for name in ('MESA','SIMPY','R4PM','SOLARA'):
            results.append(stage(name,lambda:importlib.import_module(name.lower())))
        results.append(stage('OFFLINE_VIEW',lambda:offline_view(scratch)))
    return 0 if all(results) else 1


if __name__=='__main__':
    raise SystemExit(main())
