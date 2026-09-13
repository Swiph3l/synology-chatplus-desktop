export function renderFixture() {
  document.querySelector("#app")!.innerHTML =
    `<header class="page-header"><img class="brand" src="/chatplus.png" alt="" width="52" height="52"><div><p class="eyebrow">DEVELOPMENT ONLY</p><h1>Local shell test</h1></div></header><p>This bundled fixture contains no account or server data. It is excluded from production builds.</p><section class="card"><h2>Native shell fixture</h2><label for="fixture-message">Composer preview</label><textarea id="fixture-message" rows="4" placeholder="Test keyboard input"></textarea><label for="fixture-upload">File input</label><input id="fixture-upload" type="file"><details><summary>Thread preview</summary><p>Example reply for layout checks.</p></details></section>`;
}
