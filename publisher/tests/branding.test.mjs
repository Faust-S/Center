import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
const read=path=>readFileSync(path,'utf8');
const expected=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="10" fill="#FFFFFF"/>
  <rect x="13" y="13" width="7" height="38" fill="#05070D"/>
  <path d="M29 14 L51 50 M51 14 L29 50" stroke="#05070D" stroke-width="7" stroke-linecap="butt"/>
</svg>`;
test('Publisher uses the EXACT Personal Agent IX glyph, changing green background to white only',()=>{
 const actual=read('publisher/public/favicon.svg').replace(/\r\n/g,'\n').trim();
 assert.equal(actual,expected);
 assert.match(read('publisher/index.html'),/href="\/favicon\.svg"/);
 assert.match(read('publisher/ui/App.tsx'),/className="publisher-brand-logo" src="\/favicon\.svg"/);
 assert.match(read('publisher/ui/App.tsx'),/className="publisher-hero-symbol-inner" src="\/favicon\.svg"/);
});
test('Publisher Windows icon depicts white Agent IX mark instead of placeholder',()=>{
 const png=readFileSync('publisher/src-tauri/icons/icon.png');
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 assert.equal(width,64);assert.equal(height,64);
 let offset=8;let idat;
 while(offset<png.length){
  const size=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
  if(type==='IDAT')idat=png.subarray(offset+8,offset+8+size);
  offset+=size+12;
 }
 assert.ok(idat,'Missing PNG image pixels');
 const raw=inflateSync(idat);
 const pixel=(x,y)=>[...raw.subarray(y*(1+64*4)+1+x*4,y*(1+64*4)+5+x*4)];
 assert.deepEqual(pixel(16,22),[5,7,13,255],'Agent vertical IX stroke changed');
 assert.deepEqual(pixel(27,5),[255,255,255,255],'Publisher background is not white');
 assert.equal(pixel(0,0)[3],0,'Rounded white mark lost transparent corner');
 const ico=readFileSync('publisher/src-tauri/icons/icon.ico');
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.equal(ico.readUInt16LE(4),4);
 assert.deepEqual([ico[6],ico[22],ico[38],ico[54]],[16,32,48,64]);
 const cfg=JSON.parse(read('publisher/src-tauri/tauri.conf.json'));
 assert.ok(cfg.bundle.icon.includes('icons/icon.png')&&cfg.bundle.icon.includes('icons/icon.ico'));
});
test('Publisher design uses the Agent shell while keeping Center styles untouched',()=>{
 const css=read('publisher/ui/style.css');
 assert.match(css,/\.publisher-app \.sidebar/);
 assert.match(css,/linear-gradient\(153deg,#212c40 2%,#35465e 74%,#345865 100%\)/);
 assert.match(css,/\.publisher-app \.publisher-hero/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/@media\(max-width:360px\)/);
});
