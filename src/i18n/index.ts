import en from "./en.json";
import pl from "./pl.json";
import es from "./es.json";
import { en as updateEn, pl as updatePl, es as updateEs } from "./updates";

export type Language = "en" | "pl" | "es";
export const resources = {
  en: { ...en, ...updateEn },
  pl: { ...pl, ...updatePl },
  es: { ...es, ...updateEs },
};
export type TranslationKey = keyof typeof resources.en;
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
