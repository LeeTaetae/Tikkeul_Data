import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlertCard } from '../src/components/alerts/AlertCard';
import { AlertFilter, type AlertFilterValue } from '../src/components/alerts/AlertFilter';
import { OfflineNotice, ShowMore, TrafficSection } from '../src/components/alerts/DataStatus';
import { LocationGate, OutsideServiceNotice } from '../src/components/alerts/LocationGate';
import { CautionZoneCard, ProtectionZoneCard } from '../src/components/alerts/ZoneCards';
import { Screen } from '../src/components/Screen';
import { Chip } from '../src/components/ui/Chip';
import { HeaderTitle } from '../src/components/ui/HeaderTitle';
import { ScreenHeader } from '../src/components/ui/ScreenHeader';
import { geoApi, trafficApi } from '../src/lib/api/api';
import { incidentsToAlerts, sortCautionZones, sortProtectionZones } from '../src/lib/api/convert';
import { useApi, type ApiState } from '../src/lib/api/useApi';
import { areaFor, isInKorea, regionQueryFor } from '../src/lib/location/geo';
import { useUserLocation } from '../src/lib/location/useUserLocation';
import { usePaging } from '../src/lib/usePaging';
import { colors, space } from '../src/theme';
import type { ProtectionZonesResponse } from '../src/types/traffic';

// 돌발·주의운전은 실시간 정보라 1분마다 다시 받는다(백엔드 캐시 TTL 도 60초). 보호구역은 등록 현황이라 다시 받지 않는다.
const REALTIME_REFRESH_MS = 60_000;

export default function AlertsScreen() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<AlertFilterValue>('all');
  // 한 번에 하나만 펼친다. 같은 카드를 다시 누르면 접는다.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 사용자의 실제 위치가 있을 때만 조회한다. 위치를 못 얻으면 어떤 지역의 정보도 조회하지 않는다(아래 LocationGate).
  const location = useUserLocation();
  const located = location.state.status === 'ready' ? location.state.coords : null;
  // 국내 범위 밖이면 어떤 교통정보도 조회하지 않고 안내만 보여준다.
  const outsideKorea = !!located && !isInKorea(located);
  const coords = located && !outsideKorea ? located : null;
  const areaKey = coords ? areaFor(coords).key : '';
  // 같은 0.01도 격자 안에서는 area 가 그대로라 GPS 가 조금 흔들려도 API 를 다시 부르지 않는다.
  // areaKey 가 같으면 같은 영역이라 areaKey 만 의존성으로 둔다.
  const area = useMemo(() => (coords ? areaFor(coords) : null), [areaKey]);
  const regionQuery = coords ? regionQueryFor(coords) : null;

  // 실제 API 데이터만 쓴다. Mock 데이터는 홈의 개발용 시뮬레이터에서만 쓰고 여기에 섞지 않는다.
  const incidents = useApi((signal) => trafficApi.incidents(area!.bbox, { signal }), {
    refreshMs: REALTIME_REFRESH_MS,
    key: areaKey,
    enabled: !!area,
  });
  const caution = useApi((signal) => trafficApi.cautionZones(area!.bbox, { signal }), {
    refreshMs: REALTIME_REFRESH_MS,
    key: areaKey,
    enabled: !!area,
  });
  // 보호구역은 시군구 단위라 좌표 → 시군구코드(서버가 Kakao Local 로 변환) → 보호구역 순으로 조회한다.
  // 위치가 조금 바뀌어 다시 변환하는 동안에도 이전 시군구를 유지한다. 시군구코드가 같으면 보호구역을 다시 조회하지 않는다.
  const region = useApi((signal) => geoApi.region(regionQuery!.lat, regionQuery!.lon, { signal }), {
    key: regionQuery?.key ?? '',
    enabled: !!regionQuery,
    keepPrevious: true,
  });
  const sggCd = region.state.status === 'success' ? region.state.data.sgg_cd : '';
  const zones = useApi((signal) => trafficApi.protectionZones(sggCd, { signal }), { key: sggCd, enabled: !!sggCd });
  const zoneState: ApiState<ProtectionZonesResponse> =
    region.state.status === 'error'
      ? { status: 'error', error: region.state.error, data: null }
      : region.state.status === 'success'
        ? zones.state
        : { status: 'loading', data: null };
  const zoneRetry = region.state.status === 'error' ? region.reload : zones.reload;
  const regionName = region.state.status === 'success' ? `${region.state.data.sido_name} ${region.state.data.sgg_name}`.trim() : '';

  const incidentItems = incidents.state.data?.items;
  const alerts = useMemo(
    () => (incidentItems ? incidentsToAlerts(incidentItems, t('alerts.unknownPlace')) : []),
    // 위치 정보가 없을 때 쓰는 문구가 언어마다 달라 언어가 바뀌면 다시 만든다.
    [incidentItems, i18n.language],
  );
  const filtered = useMemo(() => alerts.filter((a) => filter === 'all' || a.type === filter), [alerts, filter]);
  const cautionItems = useMemo(() => sortCautionZones(caution.state.data?.items ?? []), [caution.state.data]);
  const zoneItems = useMemo(() => sortProtectionZones(zones.state.data?.items ?? []), [zones.state.data]);

  const incidentPaging = usePaging(filtered);
  const cautionPaging = usePaging(cautionItems);
  const zonePaging = usePaging(zoneItems);

  return (
    <Screen>
      <ScreenHeader title={<HeaderTitle>{t('alerts.title')}</HeaderTitle>} />

      <OfflineNotice />

      {location.state.status !== 'ready' ? (
        <LocationGate state={location.state} onRequest={location.request} />
      ) : (
        <>
          <View style={styles.locationRow}>
            <View style={styles.locationText}>
              <Text style={styles.area}>{t('traffic.area')}</Text>
              {!!regionName && <Text style={styles.area}>{t('traffic.region', { name: regionName })}</Text>}
              {location.state.coarse && <Text style={styles.area}>{t('traffic.location.coarse')}</Text>}
            </View>
            <Chip label={t('traffic.location.refresh')} icon={RefreshCw} onPress={location.request} />
          </View>

          {outsideKorea ? (
            <OutsideServiceNotice />
          ) : (
            <>
              <TrafficSection
                title={t('traffic.section.incidents')}
                kind="realtime"
                state={incidents.state}
                onRetry={incidents.reload}
                emptyText={t('traffic.emptyIncidents')}
              >
                {() => (
                  <>
                    <AlertFilter value={filter} onChange={setFilter} />
                    {filtered.length === 0 ? (
                      <Text style={styles.empty}>{t('alerts.empty')}</Text>
                    ) : (
                      <View style={styles.list}>
                        {incidentPaging.visible.map((a) => (
                          <AlertCard
                            key={a.id}
                            alert={a}
                            expanded={expandedId === a.id}
                            onPress={(alert) => setExpandedId((cur) => (cur === alert.id ? null : alert.id))}
                          />
                        ))}
                        <ShowMore remaining={incidentPaging.remaining} onPress={incidentPaging.showAll} />
                      </View>
                    )}
                  </>
                )}
              </TrafficSection>

              <TrafficSection
                title={t('traffic.section.caution')}
                kind="realtime"
                state={caution.state}
                onRetry={caution.reload}
                emptyText={t('traffic.emptyCaution')}
              >
                {() => (
                  <View style={styles.list}>
                    {cautionPaging.visible.map((z) => (
                      <CautionZoneCard key={z.id} zone={z} />
                    ))}
                    <ShowMore remaining={cautionPaging.remaining} onPress={cautionPaging.showAll} />
                  </View>
                )}
              </TrafficSection>

              <TrafficSection
                title={t('traffic.section.protection')}
                kind="registry"
                state={zoneState}
                onRetry={zoneRetry}
                emptyText={t('traffic.emptyProtection')}
              >
                {() => (
                  <View style={styles.list}>
                    {zonePaging.visible.map((z) => (
                      <ProtectionZoneCard key={z.id} zone={z} />
                    ))}
                    <ShowMore remaining={zonePaging.remaining} onPress={zonePaging.showAll} />
                  </View>
                )}
              </TrafficSection>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  area: { fontSize: 13, lineHeight: 19, color: colors.muted },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  locationText: { flex: 1, minWidth: 0, gap: 2 },
  list: { gap: space.lg },
  empty: { fontSize: 15, color: colors.muted },
});
