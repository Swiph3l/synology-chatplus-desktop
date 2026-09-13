import license from "../../LICENSE?raw";
import { bindShellTheme } from "../theme/theme";
export async function renderLicense() {
  await bindShellTheme();
  const app = document.querySelector("#app")!;
  const title = document.createElement("h1");
  title.textContent = "GNU General Public License v3.0";
  const copyright = document.createElement("p");
  copyright.textContent =
    "ChatPlus Desktop — Copyright (c) 2026 Swiph3l — GPL-3.0-only";
  const text = document.createElement("pre");
  text.className = "license-document";
  text.textContent = license;
  app.replaceChildren(title, copyright, text);
}
