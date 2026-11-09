import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {test} from 'node:test';

const root='installer/windows/iwxa-admin-center.svg';
test('Setup and Admin Center use one IWXA symbol without an obsolete 0.2 badge',()=>{
  const canonical=readFileSync(root,'utf8');
  assert.equal(readFileSync('public/iwxa-admin-center.svg','utf8'),canonical);
  assert.match(canonical,/fill="#EF5350"/);
  assert.match(canonical,/M29 14 L51 50 M51 14 L29 50/);
  const app=readFileSync('src/App.tsx','utf8');
  assert.match(app,/className="brand-mark" src="\/iwxa-admin-center.svg"/);
  assert.doesNotMatch(app,/<span className="version">0\.2<\/span>/);
  assert.doesNotMatch(app,/IWXA Admin Center · 0\.3\.0-dev\.1/);
  const installer=readFileSync('installer/windows/SetupCore.Unified.cs','utf8');
  assert.match(installer,/install.Text = T\("Установить", "Install"\)/);
  assert.doesNotMatch(installer,/Проверить и установить/);
  const page=readFileSync('index.html','utf8');
  assert.match(page,/rel="icon" type="image\/svg\+xml" href="\/iwxa-admin-center.svg"/);
});
test('native Windows executable icon and PNG use the canonical red shape',()=>{
  const png=readFileSync('src-tauri/icons/icon.png');
  assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(png.readUInt32BE(16),256);
  assert.equal(png.readUInt32BE(20),256);
  assert.equal(png[25],6); // RGBA
  const fragments=[];
  let pos=8;
  while(pos+12<=png.length){
    const len=png.readUInt32BE(pos);
    const name=png.toString('ascii',pos+4,pos+8);
    if(name==='IDAT')fragments.push(png.subarray(pos+8,pos+8+len));
    pos+=12+len;
    if(name==='IEND')break;
  }
  const pixels=inflateSync(Buffer.concat(fragments));
  const rgba=(x,y)=>{const off=y*(1+4*256)+1+4*x;assert.equal(pixels[y*(1+4*256)],0);return [...pixels.subarray(off,off+4)]};
  assert.deepEqual(rgba(40,40),[239,83,80,255]); // red field
  assert.deepEqual(rgba(64,128),[5,7,13,255]); // black I
  assert.deepEqual(rgba(160,128),[5,7,13,255]); // black X
  assert.equal(rgba(0,0)[3],0); // rounded transparent corner
  const ico=readFileSync('src-tauri/icons/icon.ico');
  assert.equal(ico.readUInt16LE(0),0);
  assert.equal(ico.readUInt16LE(2),1);
  const entries=ico.readUInt16LE(4);
  assert.ok(entries>=5);
  let large=null;
  for(let i=0;i<entries;i++){
    const o=6+i*16;
    if(ico[o]===0&&ico[o+1]===0){
      const n=ico.readUInt32LE(o+8),start=ico.readUInt32LE(o+12);
      large=ico.subarray(start,start+n);
    }
  }
  assert.ok(large,'256px Windows icon is embedded');
  assert.deepEqual(large,png);
});