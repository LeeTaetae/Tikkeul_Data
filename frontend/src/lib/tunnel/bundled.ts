// 앱에 번들된 터널 목록(입구 좌표가 정확한 시설만)을 색인으로 읽는다. 처음 호출할 때 한 번만 만든다.
// 데이터는 ai/tunnel_detection/scripts/export_app_tunnels.py 로 생성한다(docs/TUNNEL_APPROACH.md).
import raw from '../../data/tunnelEntrances.json';
import { parseTunnelDataset, type ParsedDataset } from './dataset';

let cached: ParsedDataset | null = null;

export function loadBundledTunnels(): ParsedDataset {
  if (!cached) cached = parseTunnelDataset(raw);
  return cached;
}
