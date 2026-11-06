import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { detectPortalCandidates, portalPreviewBox, type PortalCandidate, type PortalFrame } from '../../lib/vision/portalCandidates';
import { publishPortalObservation } from '../../lib/vision/portalObservations';

export function usePortalCandidates(enabled = true, threshold = 0.6) {
  const owner=useRef(Symbol('portal-camera'));
  const lastDetectedAt=useRef<number|null>(null);
  const [sample, setSample] = useState<{frame: PortalFrame; candidates: PortalCandidate[]; at: number} | null>(null);
  useEffect(() => {
    if (!enabled) { setSample(null);publishPortalObservation(owner.current,null); return; }
    const timer = setInterval(() => {
      if(lastDetectedAt.current!==null && Date.now()-lastDetectedAt.current>1500){
        lastDetectedAt.current=null;setSample(null);publishPortalObservation(owner.current,null);
      }
    }, 500);
    return () => {clearInterval(timer);publishPortalObservation(owner.current,null);};
  }, [enabled]);
  const onPortalFrame = ({nativeEvent}: {nativeEvent: PortalFrame}) => {
    if (enabled) {
      const at=Date.now(),candidates=detectPortalCandidates(nativeEvent,threshold);
      lastDetectedAt.current=at;
      setSample({frame:nativeEvent,candidates,at});
      publishPortalObservation(owner.current,{frame:{width:nativeEvent.width,height:nativeEvent.height},candidates,detectedAtMs:at,timeBasis:'js_detection'});
    }
  };
  return {sample,onPortalFrame};
}

export function PortalCandidateOverlay({sample, boxes = true}: {
  sample: ReturnType<typeof usePortalCandidates>['sample']; boxes?: boolean;
}) {
  const [size,setSize] = useState({width:0,height:0});
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill,styles.clip]}
    onLayout={event => setSize(event.nativeEvent.layout)}>
    {boxes && sample && size.width>0 && sample.candidates.map((candidate,index) => {
      const b=portalPreviewBox(candidate.box,sample.frame,size);
      return <View key={index} style={[styles.box,{left:b.x,top:b.y,width:b.width,height:b.height}]}>
        <Text style={styles.label}>터널 후보 {index+1} · 점수 {candidate.score.toFixed(2)}</Text>
      </View>;
    })}
    <Text style={styles.badge}>{sample?.candidates.length ? '터널 후보 감지' : sample?'터널 후보 없음':'터널 후보 · 프레임 대기'} · 실험용 휴리스틱 {sample ? `${sample.candidates.length}개` : ''}{ '\n' }YOLO 결과 아님 · 개별 박스와 시설 대응 미확인</Text>
  </View>;
}

const styles=StyleSheet.create({
  clip:{overflow:'hidden'},
  box:{position:'absolute',borderWidth:2,borderColor:'#ffb020'},
  label:{color:'#ffcb70',backgroundColor:'#000b',fontSize:12,alignSelf:'flex-start'},
  badge:{position:'absolute',bottom:64,left:12,right:12,color:'#ffcb70',backgroundColor:'#000b',padding:8,fontSize:12},
});
