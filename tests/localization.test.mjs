import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/i18n/index.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "translations",
});
const context = {};
runInNewContext(result.outputFiles[0].text, context);
const { resources, setLanguage, t, localizeError } = context.translations;
test("English, Polish and Spanish have identical nonempty keys and interpolation placeholders", () => {
  const keys = Object.keys(resources.en).sort();
  for (const language of ["pl", "es"]) {
    assert.deepEqual(Object.keys(resources[language]).sort(), keys);
    for (const key of keys) {
      assert.ok(resources[language][key].trim(), `${language}: ${key}`);
      assert.deepEqual(
        [...resources[language][key].matchAll(/\{\w+\}/g)]
          .map((match) => match[0])
          .sort(),
        [...resources.en[key].matchAll(/\{\w+\}/g)]
          .map((match) => match[0])
          .sort(),
        `${language}: ${key}`,
      );
      assert.doesNotMatch(
        resources[language][key],
        /�|Ã|â€/,
        `${language}: ${key}`,
      );
    }
  }
});
test("Spanish controls, interpolation, provider validation and error feedback never fall back to English", () => {
  setLanguage("es");
  assert.equal(t("common.settings"), "Configuración");
  assert.equal(
    t("common.version", { version: "0.5.0-beta.3" }),
    "Versión 0.5.0-beta.3",
  );
  assert.equal(
    localizeError("Could not save settings."),
    "No se pudo guardar la configuración.",
  );
  assert.equal(
    localizeError("Discord web sessions require https://discord.com/."),
    "Las sesiones web de Discord requieren https://discord.com/.",
  );
  assert.equal(
    localizeError("Custom remote provider error"),
    "Custom remote provider error",
  );
  setLanguage("en");
});
