# Licensing

ChatPlus Desktop is open source under **GPL-3.0-only**, copyright (c) 2026 Swiph3l.
The root LICENSE and INSTALLER_LICENSE.txt contain the unchanged GNU GPL version 3.
NOTICE identifies this independent community project without claiming third-party
ownership. Commercial use is permitted; distribution must meet the GPL, including
corresponding source obligations. Contributors retain copyright; no CLA is required.

Cargo-deny checks dependency licenses, including the first-party package.
Most dependencies offer MIT, Apache-2.0, BSD, ISC, Zlib, BSL-1.0 or Unicode licenses.
Compound AND expressions require satisfying both licenses; OR permits a selection.
Third-party notices must remain intact when distributing covered components.

MPL-2.0 packages include cssparser, cssparser-macros, dtoa-short, option-ext and
selectors. Their file-level obligations and applicable secondary-license provisions
must be respected. Any incompatible-secondary-license notice requires renewed review.
webpki-root-certs uses CDLA-Permissive-2.0; its complete license is retained in
third-party/webpki-root-certs-LICENSE.txt and bundled. Its cargo-deny exception is
limited to that crate. No blanket license-check exemptions are used.

WebView2 is separately supplied by Microsoft. Synology's web application and marks
remain third-party property. This project's license does not relicense dependencies.
Before binary distribution, assemble required notices and corresponding source for
the final platform graph from its SBOM. Passing metadata checks alone does not prove
distribution compliance. See the [GNU compatibility list](https://www.gnu.org/licenses/license-list.html).

Suggested GitHub topics: gplv3, open-source, tauri, rust, typescript, synology-chat,
desktop-app. The standard root LICENSE supports GitHub license detection.
