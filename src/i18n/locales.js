import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';

export const locales = {
  en,
  'zh-CN': zhCN,
  ja,
};

export const SUPPORTED_LOCALES = [
  { id: 'auto', label: '' },
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'ja', label: '日本語' },
];

function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

function detectSystemLocale() {
  const nav = navigator.language || navigator.languages?.[0] || 'en';
  if (locales[nav]) return nav;
  const base = nav.split('-')[0];
  if (locales[base]) return base;
  if (base === 'zh') return 'zh-CN';
  return 'en';
}

export function resolveLocale(pref) {
  if (!pref || pref === 'auto') return detectSystemLocale();
  return locales[pref] ? pref : 'en';
}

export function createT(localeId) {
  const messages = locales[localeId] || locales.en;
  const fallback = locales.en;
  return (key, params) => {
    let text = getByPath(messages, key) ?? getByPath(fallback, key) ?? key;
    if (params && typeof text === 'string') {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    return text;
  };
}
