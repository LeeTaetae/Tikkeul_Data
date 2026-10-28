import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en';
import ko from './locales/ko';
import zh from './locales/zh';

export const LANGUAGES = ['ko', 'en', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];

// 정적 렌더(SSR)와 클라이언트 첫 렌더가 같아야 하므로 기본 언어는 ko 로 고정한다.
i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: 'ko',
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
});

export default i18n;
