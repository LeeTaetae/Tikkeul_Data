import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { detectPortalCandidates, portalPreviewBox } from '../src/lib/vision/portalCandidates.ts';

function frame(w=160,h=120) { return {width:w,height:h,rgb:Array(w*h*3).fill(210)}; }
function rect(a,x,y,w,h,color) {
  for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++)
    for(let c=0;c<3;c++) a.rgb[(yy*a.width+xx)*3+c]=color[c];
}
test('separate heuristic keeps two openings, NMS merges cutoffs, input stays unchanged',()=>{
  const a=frame(); rect(a,35,45,25,30,[10,10,10]);rect(a,95,50,28,25,[15,15,15]);
  const before=structuredClone(a),rows=detectPortalCandidates(a);
  assert.equal(rows.length,2);assert.deepEqual(a,before);
  assert(rows.every(r=>r.method==='brightness_shape_heuristic' && !('confidence' in r)));
  assert.equal(detectPortalCandidates(a,.99).length,0);
});
test('green vegetation, flat frames and malformed payloads are rejected',()=>{
  const a=frame();rect(a,35,45,25,30,[10,40,10]);
  assert.equal(detectPortalCandidates(a).length,0);
  assert.deepEqual(detectPortalCandidates(frame()),[]);
  for(const bad of [{width:10000,height:1,rgb:[]},{width:8,height:8,rgb:[NaN]}]) assert.deepEqual(detectPortalCandidates(bad),[]);
});
test('aspect-fill overlay accounts for cropping in portrait and landscape',()=>{
  const b={x:.25,y:.25,width:.5,height:.5};
  assert.deepEqual(portalPreviewBox(b,{width:100,height:200},{width:200,height:200}),{x:50,y:0,width:100,height:200});
  assert.deepEqual(portalPreviewBox(b,{width:200,height:100},{width:200,height:200}),{x:0,y:50,width:200,height:100});
});
test('both native platforms expose an opt-in, separate, rate-limited frame event',()=>{
  const android=readFileSync(new URL('../modules/vision-detector/android/src/main/java/com/tikkeuldata/vision/VisionDetectorView.kt',import.meta.url),'utf8');
  const ios=readFileSync(new URL('../modules/vision-detector/ios/VisionDetectorModule.swift',import.meta.url),'utf8');
  assert.match(android,/portalCandidatesEnabled = false/);assert.match(ios,/portalCandidatesEnabled = false/);
  assert.match(android,/now - lastPortalAt >= 500/);assert.match(ios,/now-lastPortalAt >= 0.5/);
  assert.match(android,/onDetections\(payload\)/);assert.match(ios,/self\?\.onDetections\(\[/);
});

const ai=new URL('../../ai/tunnel_detection/',import.meta.url);
const python=fileURLToPath(new URL('.venv/Scripts/python.exe',ai));
for(const [name,path,count] of [
  ['chiak3','demo/opencv_portal/regression_inputs/chiak3.jpg',1],
  ['bonghwa','demo/opencv_portal/regression_inputs/bonghwa.jpg',1],
  ['two actual portals','demo/opencv_portal/input.jpg',2],
]) {
  const source=fileURLToPath(new URL(path,ai));
  test(`real road photo: ${name}`,{skip:!existsSync(python)||!existsSync(source)},()=>{
    const code='import cv2,numpy as np,json,sys; from pathlib import Path; a=cv2.imdecode(np.frombuffer(Path(sys.argv[1]).read_bytes(),dtype=np.uint8),1); h,w=a.shape[:2]; s=160/max(w,h); a=cv2.resize(a,(round(w*s),round(h*s))); h,w=a.shape[:2]; print(json.dumps(dict(width=w,height=h,rgb=cv2.cvtColor(a,cv2.COLOR_BGR2RGB).reshape(-1).tolist())))';
    const result=spawnSync(python,['-B','-c',code,source],{encoding:'utf8',maxBuffer:2*1024*1024});
    assert.equal(result.status,0,result.stderr);
    const rows=detectPortalCandidates(JSON.parse(result.stdout));
    assert.equal(rows.length,count);
    if(name==='bonghwa') { assert(rows[0].box.x>.1 && rows[0].box.x<.3);assert(rows[0].box.width>.3); }
    if(name==='chiak3') { assert(rows[0].box.x<.3);assert(rows[0].box.x+rows[0].box.width>.7); }
  });
}
