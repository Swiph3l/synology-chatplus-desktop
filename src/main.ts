import "./ui/shell.css";
const page = new URLSearchParams(location.search).get("page");
if (page === "update") {
  const { renderUpdate } = await import("./ui/update");
  await renderUpdate();
} else if (page === "license") {
  const { renderLicense } = await import("./ui/license");
  await renderLicense();
} else if (page === "about") {
  const { renderAbout } = await import("./ui/about");
  await renderAbout();
} else if (import.meta.env.DEV && page === "fixture") {
  const { renderFixture } = await import("./ui/fixture");
  renderFixture();
} else {
  const { renderSettings } = await import("./settings/settings");
  await renderSettings();
}
document.querySelector("#app")!.removeAttribute("aria-busy");
