import en from "./en.json";
import pl from "./pl.json";
import es from "./es.json";
import de from "./de.json";
import fr from "./fr.json";
import ja from "./ja.json";
import zhTW from "./zh-TW.json";
import { en as updateEn, pl as updatePl, es as updateEs } from "./updates";

export const languageNames = {
  en: "English",
  pl: "Polski",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  ja: "日本語",
  "zh-TW": "繁體中文",
} as const;
export type Language = keyof typeof languageNames;
const english = { ...en, ...updateEn };
export type TranslationKey = keyof typeof english;
export const resources = {
  en: english,
  pl: { ...pl, ...updatePl },
  es: { ...es, ...updateEs },
  de,
  fr,
  ja,
  "zh-TW": zhTW,
} satisfies Record<Language, Record<TranslationKey, string>>;
let language: Language = "en";
export function setLanguage(value: Language | undefined) {
  language = value && value in resources ? value : "en";
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
export const currentLanguage = () => language;
export function t(
  key: TranslationKey,
  params: Record<string, string | number> = {},
): string {
  return resources[language][key].replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}
export function localizeError(
  error: unknown,
  fallback: TranslationKey = "errors.save",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const key = (Object.keys(resources.en) as TranslationKey[]).find(
    (key) => resources.en[key] === message,
  );
  // Swiph3l: Translate only ChatPlus-owned messages; remote provider/account errors must retain their original detail.
  return key ? t(key) : message || t(fallback);
}
