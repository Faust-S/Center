import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectorLayout,clampInspectorWidth,INSPECTOR_MIN,INSPECTOR_MAX,MAIN_MIN} from '../src/inspector-layout.mjs';

test('V8 native inspector never consumes the remaining editor track',()=>{
 for(let viewport=651;viewport<=2000;viewport++){
  for(const collapsed of [false,true]){
   const bounds=inspectorLayout(viewport,collapsed);
   assert.ok(bounds.max>=INSPECTOR_MIN);
   assert.ok(bounds.max<=INSPECTOR_MAX);
   for(const preferred of [NaN,0,270,355,500,680,1000]){
    const width=clampInspectorWidth(preferred,bounds);
    assert.ok(width>=bounds.min&&width<=bounds.max);
    assert.ok(bounds.shellWidth-bounds.rail-bounds.sidebar-width>=MAIN_MIN,
     `viewport ${viewport}, collapsed ${collapsed}, width ${width}`);
   }
  }
 }
});
test('compact, medium and wide windows support actual resize range',()=>{
 for(const viewport of [720,820,1024,1366]){
  const bounds=inspectorLayout(viewport,false);
  assert.ok(bounds.max>bounds.min);
  assert.equal(clampInspectorWidth(0,bounds),bounds.min);
  assert.equal(clampInspectorWidth(9999,bounds),bounds.max);
 }
 assert.equal(inspectorLayout(820,false).sidebar,0);
 assert.equal(inspectorLayout(1024,false).sidebar,225);
 assert.equal(inspectorLayout(1366,false).sidebar,247);
 assert.equal(inspectorLayout(1366,true).sidebar,0);
});
