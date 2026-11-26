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
