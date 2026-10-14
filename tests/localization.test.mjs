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
const { resources, languageNames, setLanguage, t, localizeError } =
  context.translations;
test("all seven languages have identical nonempty keys and interpolation placeholders", () => {
  const keys = Object.keys(resources.en).sort();
  assert.deepEqual(Object.keys(resources), [
    "en",
    "pl",
    "es",
    "de",
    "fr",
    "ja",
    "zh-TW",
  ]);
  assert.deepEqual(Object.keys(languageNames), Object.keys(resources));
  for (const language of Object.keys(resources)) {
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

test("new languages switch all main Settings areas and preserve interpolation and error ownership", () => {
  for (const language of ["de", "fr", "ja", "zh-TW"]) {
    setLanguage(language);
    for (const key of [
      "common.settings",
      "common.general",
      "common.notifications",
      "common.updates",
      "common.services",
      "common.changelog",
      "common.about",
      "common.close",
      "common.save",
      "settings.unsavedChanges",
      "settings.languageHelp",
      "updates.includeBeta",
      "notifications.desktop",
    ]) {
      assert.equal(t(key), resources[language][key]);
      assert.notEqual(t(key), key, `${language}: ${key}`);
    }
    // Some labels are legitimate cognates (e.g. French "Notifications").
    assert.notEqual(t("common.settings"), resources.en["common.settings"]);
    assert.ok(
      t("common.version", { version: "1.2.3-beta.4" }).includes("1.2.3-beta.4"),
    );
    assert.equal(
      localizeError("Could not save settings."),
      resources[language]["errors.save"],
    );
    assert.equal(
      localizeError("Remote provider detail"),
      "Remote provider detail",
    );
  }
  setLanguage("en");
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

test("onboarding is translated in every locale and remains provider-neutral", () => {
  const keys = [
    "onboarding.welcome",
    "onboarding.chooseFirst",
    "onboarding.addService",
    "onboarding.addAnother",
    "onboarding.continue",
    "onboarding.skip",
    "onboarding.empty",
    "onboarding.supported",
    "onboarding.serverService",
    "onboarding.workspaceService",
    "onboarding.fixedService",
    "onboarding.serviceHelp",
  ];
  for (const language of Object.keys(resources)) {
    setLanguage(language);
    for (const key of keys) {
      const value = t(key);
      assert.equal(value, resources[language][key], `${language}: ${key}`);
      assert.notEqual(value, key, `${language}: ${key}`);
      if (language !== "en")
        assert.notEqual(value, resources.en[key], `${language}: ${key}`);
      assert.doesNotMatch(value, /Synology|Discord|Slack|Mattermost/);
    }
  }
  setLanguage("en");
});
