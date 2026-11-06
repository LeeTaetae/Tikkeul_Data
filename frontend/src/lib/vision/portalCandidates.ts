import type { Box } from './visionTypes';

// A separate, on-device heuristic. Scores are NOT model confidence probabilities.
export interface PortalFrame { width: number; height: number; rgb: number[] }
export interface PortalCandidate { box: Box; score: number; method: 'brightness_shape_heuristic' }

export function candidateOverlap(a: Box, b: Box): number {
  const intersection = Math.max(0, Math.min(a.x+a.width, b.x+b.width)-Math.max(a.x,b.x)) *
    Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return intersection / (a.width*a.height+b.width*b.height-intersection || 1);
}

export function detectPortalCandidates(frame: PortalFrame, threshold = 0.6): PortalCandidate[] {
  const { width: w, height: h, rgb } = frame;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > 256 || h > 256 ||
      rgb.length !== w*h*3 || !Number.isFinite(threshold) || threshold < 0.05 || threshold > 0.99 ||
      rgb.some(v => !Number.isFinite(v) || v < 0 || v > 255)) return [];
  const gray = new Float32Array(w*h);
  const green = new Uint8Array(w*h);
  for (let i=0; i<gray.length; i++) {
    const r=rgb[i*3]!, g=rgb[i*3+1]!, b=rgb[i*3+2]!;
    gray[i]=0.299*r+0.587*g+0.114*b;
    green[i]=Number(g > r*1.08 && g > b*1.08 && g-Math.min(r,b) > 12);
  }
  const rows: PortalCandidate[]=[];
  const queue=new Int32Array(w*h);
  for (const cutoff of [35,55,75,95]) {
    const seen=new Uint8Array(w*h);
    for (let start=0; start<gray.length; start++) {
      if (seen[start] || gray[start]! >= cutoff) continue;
      let head=0, tail=1, x1=w, y1=h, x2=0, y2=0, sum=0, foliage=0;
      queue[0]=start; seen[start]=1;
      while (head<tail) {
        const at=queue[head++]!, x=at%w, y=Math.floor(at/w);
        x1=Math.min(x1,x); x2=Math.max(x2,x); y1=Math.min(y1,y); y2=Math.max(y2,y);
        sum+=gray[at]!; foliage+=green[at]!;
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
          const nx=x+dx, ny=y+dy, n=ny*w+nx;
          if (nx>=0 && nx<w && ny>=0 && ny<h && !seen[n] && gray[n]!<cutoff) { seen[n]=1; queue[tail++]=n; }
        }
      }
      const bw=x2-x1+1, bh=y2-y1+1, fill=tail/(bw*bh), interior=sum/tail;
      if (bw<8 || bh<6 || bw/bh<0.5 || bw/bh>4.5 || bw*bh/(w*h)<0.002 || tail/(w*h)<0.0004 || tail/(w*h)>0.3 ||
          y2<h*0.25 || y1>h*0.85 || y2>h*0.98 || fill<0.45 || foliage/tail>0.35) continue;
      if (x1===0 && x2===w-1) continue;
      let greenBox=0;
      for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++) greenBox+=green[y*w+x]!;
      if(greenBox/(bw*bh)>0.2) continue;
      const px=Math.max(2,Math.round(bw*0.25)), py=Math.max(2,Math.round(bh*0.3));
      const ring:number[]=[];
      for (let y=Math.max(0,y1-py); y<Math.min(h,y2+py+1); y++)
        for(let x=Math.max(0,x1-px); x<Math.min(w,x2+px+1); x++)
          if (x<x1 || x>x2 || y<y1 || y>y2) ring.push(gray[y*w+x]!);
      ring.sort((a,b)=>a-b);
      const contrast=(ring[Math.floor(ring.length/2)] ?? 0)-interior;
      if (contrast<18) continue;
      const score=0.45*Math.min(1,contrast/90)+0.25*Math.max(0,1-interior/100)+
        0.2*Math.min(1,fill/0.8)+0.1*Math.max(0,1-Math.abs((y1+bh/2)/h-0.5)/0.5);
      if(score<threshold) continue;
      // Modest, image-independent allowance for the lining outside the dark opening.
      const left=Math.max(0,x1-bw*0.08), top=Math.max(0,y1-bh*0.08);
      const right=Math.min(w,x2+1+bw*0.08), bottom=Math.min(h,y2+1+bh*0.03);
      rows.push({box:{x:left/w,y:top/h,width:(right-left)/w,height:(bottom-top)/h},score,method:'brightness_shape_heuristic'});
    }
  }
  const kept:PortalCandidate[]=[];
  for(const row of rows.sort((a,b)=>b.score-a.score))
    if(kept.every(old=>candidateOverlap(row.box,old.box)<0.4)) kept.push(row);
  return kept;
}

// Match the native preview's aspect-fill crop, not a stretched camera image.
export function portalPreviewBox(box: Box, frame: Pick<PortalFrame,'width'|'height'>, view: {width:number;height:number}): Box {
  const scale=Math.max(view.width/frame.width,view.height/frame.height);
  const dx=(view.width-frame.width*scale)/2, dy=(view.height-frame.height*scale)/2;
  return {x:dx+box.x*frame.width*scale,y:dy+box.y*frame.height*scale,
    width:box.width*frame.width*scale,height:box.height*frame.height*scale};
}
