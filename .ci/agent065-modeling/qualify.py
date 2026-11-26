"""One grouped qualification of pinned original sources. Never publish private logs or artifacts."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from public_lock import artifact_path, bind_private_root
from failure_coordinates import coordinate, structured_locations, python_trace_locations
from report_evidence import node_counts, node_accepted

SHA = re.compile(r'[0-9a-f]{40}\Z')
MODELING = re.compile(r'^tests/test_(?:modeling_.*|mesa_live_.*|mesa_ordinary_native_regression|agent065_modeling_.*)\.py$')
SAFE_NODE_ERRORS = ('E404','ETARGET','ERESOLVE','EINTEGRITY','ENOTFOUND','ECONNRESET','ETIMEDOUT','EACCES','ERR_MODULE_NOT_FOUND')
SAFE_BUILD_ERRORS = ('MODELING_NATIVE_LOCK_MISSING','MODELING_NATIVE_LOCK_IDENTITY_CHANGED','MODELING_NATIVE_LOCK_RESOLUTION_FAILED','MODELING_NATIVE_NPM_REQUIRED','MODELING_NATIVE_MANIFEST_CHANGED','MODELING_NATIVE_LOCK_CHANGED','MODELING_NATIVE_PIN_UNVERIFIED','MODELING_NATIVE_INSTALL_CHANGED','MODELING_NATIVE_TRANSITIVE_LOCK_INVALID','MODELING_DESKTOP_REACT_PIN_CHANGED','MODELING_DESKTOP_BUILD_FAILED')
SAFE_PYTHON_ERRORS = ('ModuleNotFoundError','ImportError','AssertionError','ValueError','TypeError','RuntimeError','OSError','PermissionError','FileNotFoundError','TimeoutError','KeyError','AttributeError','UnicodeDecodeError','JSONDecodeError')


def status(key, value):
    print(key + '=' + str(value), flush=True)


def cleanup_private(root):
    """Remove readonly Git packs and long Windows dependency paths."""
    root = Path(root).resolve()
    # This helper only receives the fresh qualification temporary directory.
    if not root.name.startswith('iwxa-agent065-') or root.parent == root:
        return False
    target = str(root)
    if os.name == 'nt' and not target.startswith('\\\\?\\'):
        target = '\\\\?\\UNC\\' + target[2:] if target.startswith('\\\\') else '\\\\?\\' + target
    def retry_readonly(function, path, exception):
        if isinstance(exception, PermissionError):
            os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
            function(path)
        else:
            raise exception
    for attempt in range(3):
        try:
            if sys.version_info >= (3,12):
                shutil.rmtree(target, onexc=retry_readonly)
            else:
                shutil.rmtree(target, onerror=lambda f,p,e:retry_readonly(f,p,e[1]))
        except FileNotFoundError:
            pass
        except OSError:
            if attempt < 2:time.sleep(.25)
        if not os.path.lexists(target):return True
    return False


def git_blob(raw):
    return hashlib.sha1(('blob '+str(len(raw))+'\0').encode('ascii')+raw).hexdigest()


class Qualification:
    def __init__(self, root):
        self.root = root
        self.src = root / 'source'
        self.src.mkdir()
        self.logs = root / 'logs'
        self.logs.mkdir()
        (root/'temp').mkdir()
        self.env = dict(os.environ)
        for key in ('IWXA_TEMP_READ_TOKEN','GITHUB_TOKEN','GH_TOKEN','ACTIONS_RUNTIME_TOKEN','ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL'):
            self.env.pop(key,None)
        self.env.update({
            'GIT_TERMINAL_PROMPT':'0','GIT_LFS_SKIP_SMUDGE':'1',
            'TMP':str(root/'temp'),'TEMP':str(root/'temp'),'TMPDIR':str(root/'temp'),
            'PIP_DISABLE_PIP_VERSION_CHECK':'1','PIP_NO_CACHE_DIR':'1',
            'npm_config_cache':str(root/'npm-cache'),
            'CARGO_TARGET_DIR':str(root/'cargo-target'),
            'CARGO_HOME':str(root/'cargo-home'),
            'CARGO_TERM_COLOR':'never','NO_COLOR':'1','PYTHONUTF8':'1',
            'PYTHONDONTWRITEBYTECODE':'1',
        })
        self.results = {}
        self.pytest_exit_codes = {}
        self.files = []
        self.coordinates = {}

    def run(self,label,args,*,cwd=None,env=None,timeout=600,report=True):
        log = self.logs / (label + '.log')
        code = -1
        try:
            with log.open('wb') as stream:
                p = subprocess.Popen([str(v) for v in args],cwd=cwd or self.src,
                    env=env if env is not None else self.env,stdin=subprocess.DEVNULL,
                    stdout=stream,stderr=subprocess.STDOUT,shell=False)
                try:
                    code = p.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        subprocess.run(['taskkill.exe','/PID',str(p.pid),'/T','/F'],
                            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                            timeout=30,check=False)
                    else:
                        p.kill()
                    p.wait(timeout=30)
                    code = -2
        except (OSError,subprocess.SubprocessError):
            code = -1
        data = log.read_bytes().decode('utf-8',errors='replace') if log.is_file() else ''
        if report:
            self.results[label] = code == 0
            status(label,'PASS' if code == 0 else 'TIMEOUT' if code == -2 else 'FAIL')
            if code:
                self.diagnostics(label,data)
        return code,data

    def diagnostics(self,label,data):
        # Only finite known identifiers and numeric coordinates may leave.
        for val in SAFE_NODE_ERRORS + SAFE_BUILD_ERRORS + SAFE_PYTHON_ERRORS:
            if re.search(r'(?<![A-Za-z0-9_])'+re.escape(val)+r'(?![A-Za-z0-9_])',data):
                status(label+'_CODE',val)
        for pattern in (r'\bTS[0-9]{4,5}\b',r'\berror\[E[0-9]{4}\]',r'\bCLI_[A-Z_]{1,45}\b'):
            vals = sorted(set(re.findall(pattern,data)))[:20]
            # CLI tokens can be emitted by authored source; publish only
            # fixed known failure classes, never arbitrary matched strings.
            if pattern.startswith(r'\bCLI_'):
                vals = [v for v in vals if v in ('CLI_TIMED_OUT','CLI_EXECUTION_FAILED','CLI_INPUT_INVALID','CLI_BUSY','CLI_CANCELLED')]
            for v in vals:
                status(label+'_CODE',v)
        if 'No matching distribution found' in data:status(label+'_CODE','PYPI_DISTRIBUTION_UNAVAILABLE')
        if 'Could not find a version that satisfies the requirement' in data:status(label+'_CODE','PYPI_VERSION_UNAVAILABLE')
        if 'frontendDist' in data and any(x in data.lower() for x in ('does not exist','not exist','not found')):
            status(label+'_CODE','TAURI_FRONTEND_DIST_MISSING')
        for stage,reason in re.findall(r'MODELING_NATIVE_MANIFEST_CHANGED:(SOURCE|SCRATCH):(SHAPE|DIRECT_PINS|DEPENDENCY_GROUPS|JSON_INVALID|IDENTITY|BYTES)\b',data):
            status(label+'_CODE','MODELING_NATIVE_MANIFEST_CHANGED:'+stage+':'+reason)
        if 'failed to download' in data.lower():status(label+'_CODE','DEPENDENCY_DOWNLOAD_FAILED')
        if 'could not compile' in data.lower():status(label+'_CODE','RUST_COMPILE_FAILED')

    def coordinate(self, path, line, column, *, cwd=''):
        return coordinate(path,line,column,self.src,self.coordinates,cwd=cwd)

    def node_locations(self,data,report=None):
        locations=structured_locations(report,self.src,self.coordinates,cwd='desktop') if report else set()
        for match in re.finditer(r"(?m)^\s*location: ['\"](.+):(\d{1,7}):(\d{1,5})['\"]\s*$",data):
            value=self.coordinate(*match.groups(),cwd='desktop')
            if value:locations.add(value)
        for value in sorted(locations)[:100]:status('NODE_FAILED_LOCATION',value)
        status('NODE_FAILED_LOCATIONS',len(locations))

    def manifest_identity(self, label, path, expected_blob, expected_deps):
        try:
            raw=path.read_bytes()
            actual=git_blob(raw)
            deps=json.loads(raw)['dependencies']
            changed=sum(deps.get(k)!=v for k,v in expected_deps.items()) if isinstance(deps,dict) else len(expected_deps)
            extra=len(set(deps)-set(expected_deps)) if isinstance(deps,dict) else 0
            status(label+'_BLOB',actual)
            status(label+'_CHANGED_DIRECT_PINS',changed)
            status(label+'_EXTRA_DIRECT_PINS',extra)
            same=actual==expected_blob and not changed and not extra
        except (OSError,ValueError,TypeError,KeyError):same=False
        status(label,'PASS' if same else 'FAIL')
        self.results[label]=same
        return same

    def block(self,*labels):
        for label in labels:
            self.results[label]=False
            status(label,'BLOCKED')

    def checkout(self,token,pin,tree,*,status_prefix=''):
        def emit(key,value):status(status_prefix+key,value)
        if not token or not SHA.fullmatch(pin) or not SHA.fullmatch(tree):
            emit('PRIVATE_READ','TOKEN_OR_PIN_UNAVAILABLE')
            return False
        if self.run('PRIVATE_INIT',['git','init','-q'],report=False)[0]:
            emit('PRIVATE_READ','INIT_FAIL');return False
        auth = dict(self.env)
        auth.update({'GIT_CONFIG_COUNT':'1',
            'GIT_CONFIG_KEY_0':'http.https://github.com/.extraheader',
            'GIT_CONFIG_VALUE_0':'AUTHORIZATION: basic '+base64.b64encode(('x-access-token:'+token).encode()).decode()})
        fetched = self.run('PRIVATE_FETCH',['git','fetch','--no-tags','--depth','1','https://github.com/Faust-S/iwxa-personal-agent.git',pin],env=auth,timeout=300,report=False)[0]
        del auth, token
        if fetched or self.run('PRIVATE_CHECKOUT',['git','checkout','--detach','-q',pin],report=False)[0]:
            emit('PRIVATE_READ','FETCH_FAIL');return False
        head = self.run('PRIVATE_HEAD',['git','rev-parse','HEAD'],report=False)
        actual = self.run('PRIVATE_TREE',['git','rev-parse','HEAD^{tree}'],report=False)
        if head[0] or head[1].strip()!=pin:
            emit('PRIVATE_READ','PIN_MISMATCH');return False
        if actual[0] or actual[1].strip()!=tree:
            emit('PRIVATE_READ','TREE_MISMATCH');return False
        code,listing=self.run('SOURCE_INVENTORY',['git','ls-files'],report=False)
        if code:emit('PRIVATE_READ','INVENTORY_FAIL');return False
        self.files=sorted(listing.splitlines())
        self.coordinates={path:i+1 for i,path in enumerate(self.files)}
        emit('PRIVATE_READ','PASS')
        emit('SOURCE_PIN',pin)
        emit('SOURCE_TREE',tree)
        return True

    def pytest(self,label,python,files,*,native=False,timeout=2400):
        if not files:
            self.block(label);return False
        report=self.logs/(label+'.xml')
        env=dict(self.env)
        if native:env['IWXA_MODELING_NATIVE_REQUIRED']='1'
        else:env.pop('IWXA_MODELING_NATIVE_REQUIRED',None)
        code,data=self.run(label,[python,'-m','pytest','-q','--tb=short',*files,'-o','junit_family=xunit1','--junitxml='+str(report)],
                           env=env,timeout=timeout,report=False)
        self.pytest_exit_codes[label]=code
        counts={'PASS':0,'FAIL':0,'SKIP':0}
        ordinal={v:i+1 for i,v in enumerate(files)}
        skipped_native=0
        try:
            tests=list(ET.parse(report).iter('testcase'))
            for c in tests:
                state='FAIL' if c.find('failure') is not None or c.find('error') is not None else 'SKIP' if c.find('skipped') is not None else 'PASS'
                counts[state]+=1
                path=c.get('file','').replace(chr(92),'/')
                if state=='FAIL':
                    if path in ordinal:status(label+'_FAILED_FILE',ordinal[path])
                    line=c.get('line','')
                    if path in ordinal and line.isdecimal():status(label+'_FAILED_LINE',int(line)+1)
                    # Identifiable by comparing hashes to the pinned private
                    # test catalogue, without copying test names or messages.
                    key=c.get('classname','')+'::'+c.get('name','')
                    status(label+'_FAILED_CASE_SHA256',hashlib.sha256(key.encode('utf-8')).hexdigest())
                    failure=c.find('failure')
                    if failure is None:failure=c.find('error')
                    for location in python_trace_locations(failure.text or '',self.src,self.coordinates):
                        status(label+'_FAILED_TRACE',location)
                if native and state=='SKIP':
                    skipped_native+=1
            good=code==0 and bool(tests) and not counts['FAIL'] and not skipped_native
        except (OSError,ValueError,ET.ParseError):
            good=False
        for key,count in counts.items():status(label+'_'+key,count)
        status(label+'_MODULES',len(files))
        self.results[label]=good
        status(label,'PASS' if good else 'TIMEOUT' if code==-2 else 'FAIL')
        if not good:self.diagnostics(label,data)
        return good

    def venv(self,name,requirements):
        root=self.root/name
        if self.run(name.upper()+'_VENV',[sys.executable,'-m','venv',str(root)],timeout=180)[0]:
            return None
        exe=root/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        args=[exe,'-m','pip','install','--disable-pip-version-check']
        for req in requirements:args.extend(['-r',self.src/req])
        if self.run(name.upper()+'_DEPENDENCIES',args,timeout=900)[0]:
            return None
        return exe

    def python(self):
        status('PYTHON_BASELINE','3.12' if sys.version_info[:2]==(3,12) else 'UNEXPECTED')
        if sys.version_info[:2]!=(3,12):return False
        catalog=[x for x in self.files if re.fullmatch(r'tests/(?:[A-Za-z0-9_]+/)*test_[A-Za-z0-9_]+\.py',x)]
        core=[x for x in catalog if not MODELING.fullmatch(x)]
        modeling=[x for x in catalog if MODELING.fullmatch(x)]
        # Deliberately disjoint test groups: no repeated native subsets.
        status('PYTHON_CATALOGUE',len(catalog))
        if len(catalog)<400 or len(modeling)<20:return False
        self.run('PYTHON_COMPILE',[sys.executable,'-m','compileall','-q','adapters','runtime','cells','providers','surfaces'],timeout=180)
        core_python=self.venv('coreqa',['requirements-ci.txt'])
        if core_python is not None:self.pytest('CORE_REGRESSION',core_python,core,timeout=3300)
        else:self.block('CORE_REGRESSION')
        native_python=self.venv('modelqa',['requirements-ci.txt','qualification/modeling-preparation/requirements.txt'])
        if native_python is None:
            self.block('NATIVE_VERSION_CHECK','MODELING_NATIVE_REGRESSION')
        else:
            self.run('NATIVE_VERSION_CHECK',[native_python,'-c',
                "from importlib.metadata import version; from tempfile import TemporaryDirectory; from adapters.modeling.mesa_live_dependencies import prepare_native_environment,require_native_dependencies; scratch=TemporaryDirectory(); prepare_native_environment(scratch.name); require_native_dependencies(scratch.name); import mesa,simpy,r4pm,solara; pins={'mesa':'3.5.2','simpy':'4.1.2','r4pm':'0.6.2','solara':'1.66.3','solara-ui':'1.66.3','solara-server':'1.66.3','solara-assets2':'1.1.0'}; assert all(version(k)==v for k,v in pins.items()); scratch.cleanup()"],timeout=120)
            self.pytest('MODELING_NATIVE_REGRESSION',native_python,modeling,native=True,timeout=1800)
        status('INSTALLED_GUI','NOT_RUN')
        return all(self.results.values())

    def desktop(self, *, build=True):
        node=shutil.which('node')
        npm=shutil.which('npm.cmd')
        if not node or not npm:
            self.block('NODE_TOOLCHAIN');return False
        npmcli=Path(npm).parent/'node_modules'/'npm'/'bin'/'npm-cli.js'
        if not npmcli.is_file():
            self.block('NODE_TOOLCHAIN');return False
        desktop=self.src/'desktop'
        native_manifest=desktop/'modeling-native'/'package.json'
        manifest_git_path='desktop/modeling-native/package.json'
        code,entry=self.run('NATIVE_MANIFEST_GIT',['git','ls-tree','HEAD','--',manifest_git_path],report=False)
        match=re.fullmatch(r'100644 blob ([0-9a-f]{40})\t'+re.escape(manifest_git_path)+r'\s*',entry)
        if code or match is None:
            self.block('NATIVE_MANIFEST_INITIAL');return False
        expected_blob=match[1]
        expected_deps=json.loads(native_manifest.read_bytes())['dependencies']
        if not isinstance(expected_deps,dict) or not self.manifest_identity('NATIVE_MANIFEST_INITIAL',native_manifest,expected_blob,expected_deps):
            return False
        def cmd(label,*args,timeout=900,env=None):
            return self.run(label,[node,npmcli,*args],cwd=desktop,timeout=timeout,env=env)[0]==0
        if not cmd('DESKTOP_NPM_CI','ci','--ignore-scripts','--no-audit','--no-fund'):
            self.block('NATIVE_LOCK','NATIVE_INSTALL','NODE_REGRESSION','FULL_DESKTOP_BUILD','RUST_TESTS','TAURI_BUILD')
            return False
        self.manifest_identity('NATIVE_MANIFEST_AFTER_DESKTOP_CI',native_manifest,expected_blob,expected_deps)
        native_lock=desktop/'modeling-native'/'package-lock.json'
        committed='desktop/modeling-native/package-lock.json' in self.files
        if committed:
            status('NATIVE_LOCK_SOURCE','COMMITTED')
            lock_ok=native_lock.is_file()
            self.results['NATIVE_LOCK']=lock_ok;status('NATIVE_LOCK','PASS' if lock_ok else 'FAIL')
        else:
            public_graph=artifact_path()
            if public_graph.is_file():
                try:
                    raw=public_graph.read_bytes()
                    bound=bind_private_root(raw,json.loads(native_manifest.read_bytes()))
                    with native_lock.open('xb') as stream:
                        stream.write(bound)
                    lock_ok=True
                    status('NATIVE_LOCK_SOURCE','PUBLIC_UPSTREAM_GRAPH')
                    status('NATIVE_PUBLIC_GRAPH_SHA256',hashlib.sha256(raw).hexdigest())
                    status('NATIVE_LOCK','PASS')
                    self.results['NATIVE_LOCK']=True
                except (OSError,ValueError,TypeError,KeyError):
                    lock_ok=False
                    status('NATIVE_LOCK_SOURCE','PUBLIC_UPSTREAM_GRAPH')
                    status('NATIVE_LOCK','FAIL')
                    self.results['NATIVE_LOCK']=False
            else:
                status('NATIVE_LOCK_SOURCE','TEMPORARY')
                lock_ok=cmd('NATIVE_LOCK','run','modeling:lock') and native_lock.is_file()
        self.manifest_identity('NATIVE_MANIFEST_AFTER_LOCK',native_manifest,expected_blob,expected_deps)
        if lock_ok:status('NATIVE_LOCK_SHA256',hashlib.sha256(native_lock.read_bytes()).hexdigest())
        elif self.results.get('NATIVE_LOCK'):
            self.results['NATIVE_LOCK']=False
            status('NATIVE_LOCK','FAIL')
        else:
            # On a failed resolution, inspect only direct public dependency
            # availability, by ordinal, not arbitrary npm error text.
            deps=json.loads((desktop/'modeling-native'/'package.json').read_text(encoding='utf-8'))['dependencies']
            for i,(name,version) in enumerate(sorted(deps.items()),1):
                if not re.fullmatch(r'(?:@[a-z0-9-]+/)?[a-z0-9-]+',name) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):continue
                code,out=self.run('NATIVE_VIEW_'+str(i),[node,npmcli,'view',name+'@'+version,'version','--json','--registry=https://registry.npmjs.org'],cwd=desktop,timeout=60,report=False)
                try:matches=json.loads(out)==version
                except (ValueError,TypeError):matches=False
                status('NATIVE_PIN_'+str(i),'PASS' if code==0 and matches else 'UNAVAILABLE')
        installed=lock_ok and cmd('NATIVE_INSTALL','run','modeling:ci')
        if not lock_ok:self.block('NATIVE_INSTALL')
        manifest_ok=self.manifest_identity('NATIVE_MANIFEST_AFTER_INSTALL',native_manifest,expected_blob,expected_deps)
        gate=False
        if installed and manifest_ok:
            gate=self.run('NATIVE_BUILD_GATE',[node,'--input-type=module','-e',"import {requireNativeModeling} from './modeling-native/build-gate.mjs'; requireNativeModeling();"],cwd=desktop,timeout=120)[0]==0
        else:self.block('NATIVE_BUILD_GATE')
        env=dict(self.env)
        if gate:env['IWXA_MODELING_NATIVE_REQUIRED']='1'
        else:env.pop('IWXA_MODELING_NATIVE_REQUIRED',None)
        # The native test runner's four files are in the original Node suite.
        # With the gate above and required-native flag, run all once.
        report=self.logs/'node-failures.jsonl'
        reporter=Path(__file__).with_name('node-failures.mjs').resolve().as_uri()
        code,out=self.run('NODE_REGRESSION',[node,'--test','--test-reporter=tap',
                          '--test-reporter='+reporter,'--test-reporter-destination=stdout',
                          '--test-reporter-destination='+str(report)],cwd=desktop,env=env,timeout=1500,report=False)
        counts=node_counts(out)
        if counts is not None:
            for k,v in counts.items():
                status('NODE_'+k.upper(),v)
        status('NODE_SUMMARY_EVIDENCE','PASS' if counts is not None else 'FAIL')
        node_ok=node_accepted(code,gate,counts)
        self.results['NODE_REGRESSION']=node_ok
        status('NODE_REGRESSION','PASS' if node_ok else 'FAIL')
        if not node_ok:
            self.diagnostics('NODE_REGRESSION',out)
            self.node_locations(out,report)
        if not build:
            return gate and node_ok and all(self.results.values())
        full=gate and cmd('FULL_DESKTOP_BUILD','run','build',timeout=1200)
        if not gate:self.block('FULL_DESKTOP_BUILD')
        # Core-only dist is only a diagnostic for Rust compilation, never
        # evidence of a complete native modeling product.
        core_only=False
        if not full:
            core_only=cmd('CORE_ONLY_DESKTOP_BUILD','run','build:core',timeout=900)
        if full or core_only:
            status('RUST_FRONTEND_PROFILE','NATIVE' if full else 'CORE_ONLY')
            cargo=shutil.which('cargo')
            if cargo:
                rust_env=dict(self.env)
                rust_env.pop('TAURI_CONFIG',None)
                if core_only:
                    # The diagnostic Vite profile deliberately does not write dist.
                    # Tauri's original build and codegen both merge TAURI_CONFIG.
                    rust_env['TAURI_CONFIG']=json.dumps({'build':{'frontendDist':'../dist-core-check'}})
                rust_dist=desktop/('dist' if full else 'dist-core-check')
                if not (rust_dist/'index.html').is_file():
                    self.block('RUST_TESTS')
                else:
                    self.run('RUST_TESTS',[cargo,'test','--locked','--manifest-path',desktop/'src-tauri'/'Cargo.toml'],cwd=desktop,env=rust_env,timeout=1800)
                if full:
                    # Reuse the already-built original full Vite dist.
                    self.run('TAURI_BUILD',[node,desktop/'node_modules'/'@tauri-apps'/'cli'/'tauri.js','build','--no-bundle','--ci'],cwd=desktop,env=rust_env,timeout=2400)
                else:self.block('TAURI_BUILD')
            else:self.block('RUST_TESTS','TAURI_BUILD')
        else:self.block('RUST_TESTS','TAURI_BUILD')
        status('NATIVE_LOCK_PERSISTED','YES' if committed and lock_ok else 'NO')
        status('INSTALLED_GUI','NOT_RUN')
        return all(self.results.values())


def main():
    token=os.environ.pop('IWXA_TEMP_READ_TOKEN','')
    pin=os.environ.get('PRIVATE_PIN','')
    tree=os.environ.get('PRIVATE_TREE','')
    group=os.environ.get('QUALIFICATION_GROUP','')
    root=None
    result=False
    try:
        root=Path(tempfile.mkdtemp(prefix='iwxa-agent065-',dir=os.environ['RUNNER_TEMP']))
        q=Qualification(root)
        if group in ('python','desktop') and q.checkout(token,pin,tree):
            del token
            result=getattr(q,group)()
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):
        status('QUALIFICATION_INTERNAL','FAIL')
    finally:
        if root is not None:
            clean=cleanup_private(root)
            status('PRIVATE_CLEANUP','PASS' if clean else 'FAIL')
            result=result and clean
    status('GROUP_QUALIFICATION','PASS' if result else 'FAIL')
    return 0 if result else 1


if __name__=='__main__':
    sys.exit(main())
