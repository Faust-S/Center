"""Temporary upstream npm graph, generated BEFORE any private checkout.

The artifact never contains the private project's package.json, root identity,
source or result. Bind its verified upstream graph back to the private root only
inside the subsequent private qualification or in the private working copy.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

NAME = 'public-modeling-dependencies'
VERSION = '1.0.0'
PINS = {'@r4pm/components': '0.5.0', 'bpmn-js': '18.33.1',
        'bpmn-moddle': '10.3.1', 'bpmn-auto-layout': '1.3.0',
        'dmn-js': '18.1.0', 'dmn-moddle': '12.2.1',
        'react': '19.3.1', 'react-dom': '19.3.1'}
MAX_BYTES = 4_000_000


def parse(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError('PUBLIC_LOCK_SIZE')
    def unique(pairs):
        d = {}
        for k, v in pairs:
            if k in d:
                raise ValueError('PUBLIC_LOCK_DUPLICATE_KEY')
            d[k] = v
        return d
    return json.loads(raw, object_pairs_hook=unique)


def validate_public_lock(raw):
    data = parse(raw)
    if (not isinstance(data, dict) or set(data) != {'name','version','lockfileVersion','requires','packages'}
            or data['name'] != NAME or data['version'] != VERSION
            or data['lockfileVersion'] != 3 or data['requires'] is not True):
        raise ValueError('PUBLIC_LOCK_ROOT')
    packages = data['packages']
    root = packages.get('') if isinstance(packages,dict) else None
    if not isinstance(root,dict) or root.get('dependencies') != PINS:
        raise ValueError('PUBLIC_LOCK_DIRECT')
    if root != {'name':NAME,'version':VERSION,'dependencies':PINS}:
        raise ValueError('PUBLIC_LOCK_ROOT_ENTRY')
    for name, pin in PINS.items():
        row = packages.get('node_modules/'+name)
        if not isinstance(row,dict) or row.get('version') != pin:
            raise ValueError('PUBLIC_LOCK_PIN')
    for path, row in packages.items():
        if not path:
            continue
        if (not path.startswith('node_modules/') or '\\' in path or '..' in path.split('/')
                or not isinstance(row,dict) or row.get('link')
                or not isinstance(row.get('version'),str)
                or not re.fullmatch(r'sha512-[A-Za-z0-9+/]+={0,2}',str(row.get('integrity','')))
                or not isinstance(row.get('resolved'),str)
                or not row['resolved'].startswith('https://registry.npmjs.org/')):
            raise ValueError('PUBLIC_LOCK_PACKAGE')
    return data


def bind_private_root(raw, manifest):
    data = validate_public_lock(raw)
    if (not isinstance(manifest,dict) or manifest.get('dependencies') != PINS
            or not isinstance(manifest.get('name'),str) or not isinstance(manifest.get('version'),str)
            or any(k in manifest for k in ('devDependencies','peerDependencies','optionalDependencies','overrides','workspaces','bundleDependencies','bundledDependencies'))):
        raise ValueError('PUBLIC_LOCK_BIND_MANIFEST')
    for key in ('name','version'):
        data[key] = manifest[key]
        data['packages'][''][key] = manifest[key]
    return (json.dumps(data, ensure_ascii=False, indent=2)+'\n').encode('utf-8')


def artifact_path():
    return Path(os.environ['RUNNER_TEMP'])/'iwxa-public-npm-modeling-graph'/'package-lock.json'


def generate():
    path=artifact_path()
    if path.parent.exists():
        raise ValueError('PUBLIC_LOCK_TARGET_EXISTS')
    node, npm = shutil.which('node'), shutil.which('npm.cmd' if os.name=='nt' else 'npm')
    if not node or not npm:
        raise ValueError('PUBLIC_LOCK_NPM_REQUIRED')
    cli=(Path(npm).parent/'node_modules'/'npm'/'bin'/'npm-cli.js' if os.name=='nt' else Path(npm).resolve())
    if not cli.is_file():
        raise ValueError('PUBLIC_LOCK_NPM_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='iwxa-upstream-npm-',dir=os.environ['RUNNER_TEMP']) as d:
        root=Path(d)
        manifest = json.dumps({'name':NAME,'version':VERSION,'private':True,'dependencies':PINS}).encode('utf-8')
        (root/'package.json').write_bytes(manifest)
        env={k:v for k,v in os.environ.items() if not k.lower().startswith('npm_config_') and k not in ('NODE_AUTH_TOKEN','NPM_TOKEN','GITHUB_TOKEN','GH_TOKEN','IWXA_TEMP_READ_TOKEN')}
        env['npm_config_cache']=str(root/'cache')
        with (root/'npm.log').open('wb') as log:
            result=subprocess.run([node,str(cli),'update','--no-save','--prefix',str(root),'--package-lock-only','--lockfile-version=3','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=600)
        if result.returncode:
            raise ValueError('PUBLIC_LOCK_RESOLUTION_FAILED')
        if (root/'package.json').read_bytes() != manifest:
            raise ValueError('PUBLIC_LOCK_MANIFEST_CHANGED')
        raw=(root/'package-lock.json').read_bytes()
        graph=validate_public_lock(raw)
        path.parent.mkdir()
        with path.open('xb') as out:
            out.write(raw)
        print('PUBLIC_NPM_GRAPH_PACKAGES='+str(len(graph['packages'])-1),flush=True)
        print('PUBLIC_NPM_GRAPH_SHA256='+hashlib.sha256(raw).hexdigest(),flush=True)
        print('PUBLIC_NPM_GRAPH=PASS',flush=True)


if __name__=='__main__':
    try:
        generate()
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError) as exc:
        # Finite public-only diagnostic codes; never echo npm output.
        known={'PUBLIC_LOCK_SIZE','PUBLIC_LOCK_DUPLICATE_KEY','PUBLIC_LOCK_ROOT',
               'PUBLIC_LOCK_DIRECT','PUBLIC_LOCK_ROOT_ENTRY','PUBLIC_LOCK_MANIFEST_CHANGED','PUBLIC_LOCK_PIN','PUBLIC_LOCK_PACKAGE',
               'PUBLIC_LOCK_TARGET_EXISTS','PUBLIC_LOCK_NPM_REQUIRED','PUBLIC_LOCK_RESOLUTION_FAILED'}
        reason=str(exc)
        print('PUBLIC_NPM_GRAPH_CODE='+(reason if reason in known else 'PUBLIC_LOCK_INTERNAL'),flush=True)
        print('PUBLIC_NPM_GRAPH=FAIL',flush=True)
        raise SystemExit(1)
