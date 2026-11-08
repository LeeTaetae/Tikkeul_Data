// 네이티브 위험 레일의 상세 문장. 웹 HazardDetail 과 같은 i18n 키·같은 사실만 쓰고, 없는 정보는 지어내지 않는다.
// 거리는 넣지 않는다: 네이티브가 카드의 실시간 거리를 붙이므로 문장이 거리 때문에 계속 바뀌면 안 된다.
import { describeHazard, type RailItem } from '../hazardRail';
import { localizeAlert } from '../localizeAlert';
import { formatDateTimeKst } from '../time';
import type { MatchReason } from '../routeHazards';

type Translate = (key: string, params?: Record<string, unknown>) => string;

const DIRECTION_REASONS: MatchReason[] = ['directionUnknown', 'singleDirectionUnverified'];
const REASONS_WITH_TEXT: MatchReason[] = ['directionUnknown', 'singleDirectionUnverified', 'lateralUncertain', 'staleData', 'freshnessUnknown', 'positionUncertain', 'walkingNotConfirmable'];

export function describeHazardForNative(item: RailItem, t: Translate, language: string): string {
  const detail = describeHazard(item);
  const probable = item.matchClass === 'probable';
  const status = probable
    ? detail.unverifiedReason && DIRECTION_REASONS.includes(detail.unverifiedReason) ? t('nav.rail.unverified.direction') : t('nav.rail.unverified.route')
    : t('nav.rail.class.confirmed');
  const place = localizeAlert(item.alert, language).location || t('alerts.unknownPlace');
  const lines = [`${t('nav.rail.locationLabel')}: ${place}`, status];
  if (detail.source === 'its') lines.push(detail.startedIso ? t('alerts.startedAt', { time: formatDateTimeKst(detail.startedIso) }) : t('nav.rail.noStarted'));
  lines.push(`${t('nav.rail.sourceLabel')}: ${t(`nav.rail.source.${detail.source}`)}`);
  if (probable && detail.unverifiedReason && REASONS_WITH_TEXT.includes(detail.unverifiedReason)) lines.push(t(`nav.rail.reason.${detail.unverifiedReason}`));
  for (const note of detail.notes) lines.push(t(`nav.rail.note.${note}`));
  return lines.join('\n');
}
