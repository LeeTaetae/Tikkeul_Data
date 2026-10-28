import type { RoadAlert } from '../types/alert';

// 현재 언어에 맞는 위치·설명. 번역이 없는 언어(실제 API 데이터 포함)는 원문(한국어)으로 대체한다.
export function localizeAlert(alert: RoadAlert, language: string): { location: string; description: string } {
  const tr = language === 'en' || language === 'zh' ? alert.translations?.[language] : undefined;
  return {
    location: tr?.location ?? alert.location,
    description: tr?.description ?? alert.description,
  };
}
