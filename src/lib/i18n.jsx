import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, translate, translateError, format } from './i18n-dict';

export { LANGUAGES, EN, EN_ERRORS, translate, translateError, format } from './i18n-dict';

const STORAGE_KEY = 'ss_lang';

const I18nContext = createContext({ lang: 'ru', setLang: () => {}, t: value => value, tf: value => value, te: value => value, loc: (obj, field) => obj?.[field] });

function readStoredLang() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return LANGUAGES.some(([code]) => code === stored) ? stored : 'ru';
  } catch { return 'ru'; }
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang);
  const setLang = useCallback(next => {
    const value = LANGUAGES.some(([code]) => code === next) ? next : 'ru';
    setLangState(value);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, value); } catch { /* private mode: keep in memory */ }
  }, []);
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* non-DOM render */ } }, [lang]);
  const value = useMemo(() => ({
    lang, setLang,
    t: key => translate(key, lang),
    tf: (key, vars) => format(translate(key, lang), vars),
    te: message => translateError(message, lang),
    // Server content carries an optional `en` block; fall back to the Russian field.
    loc: (obj, field) => (lang === 'en' && obj?.en?.[field]) || obj?.[field]
  }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() { return useContext(I18nContext); }
