from copy import deepcopy
import json
import pytest
from public_lock import NAME, VERSION, PINS, validate_public_lock, bind_private_root


def fixture():
    return {'name':NAME,'version':VERSION,'lockfileVersion':3,'requires':True,
        'packages':{'':{'name':NAME,'version':VERSION,'dependencies':PINS},
        **{'node_modules/'+name:{'version':pin,'integrity':'sha512-AAAA','resolved':'https://registry.npmjs.org/fixture.tgz'} for name,pin in PINS.items()}}}


def raw(value):return json.dumps(value).encode('utf-8')


def test_binding_changes_only_root_identity():
    data=fixture()
    manifest={'name':'private-fixture','version':'0.6.5','dependencies':PINS,'private':True}
    bound=json.loads(bind_private_root(raw(data),manifest))
    assert bound['name']==manifest['name'] and bound['packages']['']['version']=='0.6.5'
    assert {k:v for k,v in bound['packages'].items() if k}=={k:v for k,v in data['packages'].items() if k}
    assert bound['packages']['']['dependencies']==PINS
    assert validate_public_lock(raw(data))==data
    assert bind_private_root(raw(data),manifest)==bind_private_root(raw(data),manifest)


@pytest.mark.parametrize('change',['identity','pin','registry','root-extra','link'])
def test_reject_invalid_graph(change):
    data=deepcopy(fixture());first=data['packages']['node_modules/bpmn-js']
    if change=='identity':data['name']='private-source'
    elif change=='pin':first['version']='0.0.0'
    elif change=='registry':first['resolved']='https://example.org/private.tgz'
    elif change=='root-extra':data['packages']['']['private_path']='x'
    elif change=='link':first['link']=True
    with pytest.raises(ValueError):validate_public_lock(raw(data))


def test_mismatching_private_manifest_rejected():
    with pytest.raises(ValueError):bind_private_root(raw(fixture()),{'name':'x','version':'1','dependencies':{**PINS,'bpmn-js':'^18.33.1'}})


@pytest.mark.parametrize('mutate',[False, True])
def test_generate_no_save_command_and_byte_identity(tmp_path,monkeypatch,mutate):
    import public_lock as p
    from types import SimpleNamespace
    monkeypatch.setenv('RUNNER_TEMP',str(tmp_path))
    cli=tmp_path/'tools'/'node_modules'/'npm'/'bin'/'npm-cli.js';cli.parent.mkdir(parents=True);cli.touch()
    npm=tmp_path/'tools'/'npm.cmd';npm.touch()
    monkeypatch.setattr(p.shutil,'which',lambda name: str(cli if name=='npm' else npm if name=='npm.cmd' else 'node'))
    expected=raw(fixture())
    def run(args,**kwargs):
        assert args[2:4]==['update','--no-save']
        assert '--package-lock-only' in args and '--lockfile-version=3' in args
        assert '--save-exact' not in args
        root=kwargs['cwd']; path=root/'package.json'
        assert json.loads(path.read_bytes())['dependencies']==PINS
        if mutate:path.write_bytes(path.read_bytes()+b' ')
        (root/'package-lock.json').write_bytes(expected)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(p.subprocess,'run',run)
    if mutate:
        with pytest.raises(ValueError,match='PUBLIC_LOCK_MANIFEST_CHANGED'):p.generate()
        assert not p.artifact_path().exists()
    else:
        p.generate();assert p.artifact_path().read_bytes()==expected


def test_root_entry_and_direct_pins_are_distinct_errors():
    value=fixture(); value['packages']['']['license']='fixture'
    with pytest.raises(ValueError,match='PUBLIC_LOCK_ROOT_ENTRY'):validate_public_lock(raw(value))
    value=fixture();value['packages']['']['dependencies']={**PINS,'bpmn-js':'^18.33.1'}
    with pytest.raises(ValueError,match='PUBLIC_LOCK_DIRECT'):validate_public_lock(raw(value))
