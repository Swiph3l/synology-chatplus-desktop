import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const result = await build({
  entryPoints: ["src/app/notification-colors.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "colorApi",
});
const context = {
  crypto: {
    getRandomValues(bytes) {
      bytes.set([0, 127, 255]);
      return bytes;
    },
  },
};
runInNewContext(result.outputFiles[0].text, context);
const {
  normalizeNotificationColor,
  resolveNotificationColor,
  randomNotificationColor,
} = context.colorApi;
const style = (notificationColor) =>
  resolveNotificationColor({
    provider: "discord",
    notificationColor,
  });

test("persisted custom colors accept exactly six hexadecimal digits and normalize case", () => {
  for (const [input, expected] of [
    ["#000000", "#000000"],
    ["#FFFFFF", "#ffffff"],
    ["#aB12Ef", "#ab12ef"],
  ]) {
    assert.equal(normalizeNotificationColor(input), expected);
    assert.equal(style(input).background, expected);
  }
  for (const invalid of [
    undefined,
    null,
    255,
    {},
    "#fff",
    "#ff000000",
    "#gg0000",
    "#ffffff ",
    " #ffffff",
    "rgb(255,0,0)",
    "var(--accent)",
    "#ffffff; background: url(https://example.com/)",
  ]) {
    assert.equal(normalizeNotificationColor(invalid), "auto");
    assert.equal(style(invalid).background, "var(--accent)");
  }
  assert.equal(normalizeNotificationColor("purple"), "purple");
  assert.equal(style("purple").background, "#8354c6");
});

test("custom badge text chooses readable black or white including RGB boundary colors", () => {
  assert.equal(style("#000000").foreground, "#ffffff");
  assert.equal(style("#ffffff").foreground, "#000000");
  assert.equal(style("#ff0000").foreground, "#000000");
  assert.equal(style("#0000ff").foreground, "#ffffff");
  const levels = [0, 32, 64, 96, 128, 160, 192, 224, 255];
  for (const r of levels)
    for (const g of levels)
      for (const b of levels) {
        const color = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        const linear = [r, g, b]
          .map((value) => value / 255)
          .map((value) =>
            value <= 0.04045
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4),
          );
        const background =
          0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        const foreground = style(color).foreground === "#000000" ? 0 : 1;
        const ratio =
          (Math.max(background, foreground) + 0.05) /
          (Math.min(background, foreground) + 0.05);
        assert.ok(ratio >= 4.5, `${color} text contrast ${ratio}`);
      }
});

test("random defaults sample three independent RGB channels and persist as a color value", () => {
  assert.equal(randomNotificationColor(), "#007fff");
  assert.equal(
    normalizeNotificationColor(randomNotificationColor()),
    "#007fff",
  );
});
