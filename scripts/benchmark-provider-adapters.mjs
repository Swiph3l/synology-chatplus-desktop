import path from "node:path";
import { providerFixtures } from "../tests/helpers/provider-fixtures.mjs";

// Every source checkout runs through this same synthetic DOM and toolchain.
// This counts application layout queries, not provider traffic or process CPU.
const entry = path.resolve(process.argv[2] ?? ".", "src/theme/unread.ts");
const fixture = await providerFixtures(entry);
const providers = [
  "synology-chatplus",
  "synology-chat",
  "discord",
  "whatsapp",
  "messenger",
  "mattermost",
  "slack",
];
const views = providers.map((provider) =>
  fixture(provider, false, undefined, 128),
);
for (let projection = 0; projection < 20; projection++) {
  for (const view of views) {
    view.host.__chatplusSetForeground?.(false, 1, 0);
    view.flush();
  }
}
const results = views.map((view, index) => ({
  provider: providers[index],
  selectors: view.selectors(),
  geometry: view.geometry(),
  unreadPackets: view.messages.length,
}));
console.log(JSON.stringify(results, null, 2));
