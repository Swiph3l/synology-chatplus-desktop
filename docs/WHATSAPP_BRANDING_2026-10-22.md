# WhatsApp browser identity investigation — 2026-10-22

The user's iPhone screenshot shows **Microsoft Edge** in the confirmation before
linking a device. Changing the ChatPlus executable/product/window name does not
provide a demonstrated way to change this WhatsApp screen. This request remains
unresolved under the original requirement to use official WhatsApp Web without
private APIs, pairing-data manipulation or unsupported client impersonation.

## Public first-party evidence

Fresh unauthenticated WhatsApp HTML was used only to locate public static assets.
No account, QR value, pairing payload or session storage was inspected.

- `WAWebBrowserInfo` uses the bundled UA parser and recognizes the Microsoft Edge
  Client Hints brand.
- `WAWebCompanionPlatformType` maps recognized browser families to a fixed enum;
  Edge maps to `EDGE`, and unrecognized names map to `UNKNOWN`.
- `WAWebClientPayload` builds device properties using that platform enum and the
  parsed OS name. No arbitrary embedder display-name option was identified.

Relevant public assets, downloaded on the audit date:

- [Browser information](https://static.whatsapp.net/rsrc.php/v4iH7h4/yJ/l/en_US-j/9leKHM4vLiZBdU_hcBHl6rEhPL1D1w7l5atZVz1XNj2e_YP62LrB38qXF9_nOsF9IVhsqTKrjvmRHNKOBPdbaM362202vnpjcaq9wOG39rwPJYwPetd047d4sPsHB1ibGrbJP1NnRfhoJ_G7yQKSv7A_M0BV4bpmtIt7R1iKsn8dh0KRyLAlLnAxqQ54EIeUY9UHO17rZQrzh2svr.js):
  SHA-256 `f5754eb8c0a14198c67719b50cd6b402cd48545536dad1aec4f2ed8ca93497b1`.
- [Platform mapping and client payload](https://static.whatsapp.net/rsrc.php/v4iMIC4/yh/l/en_US-j/uxnQksOMZKjxmvzL2Hme7iJBw2dWCVa0BBxgWBYdHv4dFTtq7zwpbbDNl9ZYyREraxVmIHUz_jTaW2Px67ruRd1hfxsU2N6Lb5FJSbQUtRw7z4gf5ZzSkPy3NKkgN-JyvcyaWUUKocWarAuK_4mZeGcLbB_23LEffI1_Xwo8zQ5TASp1vdPdCSIMPYUBG5Pz7vmDjrPeSG3ZS38fx7KJoSQKFgmFOYAuspDhlhzZk-PQqXYsbbk9E_PXJB2--zdZJywGwzJ6i9SaU-4ORb_dFMJ40LPHSxj0YAvs-ocQZvVbfeyWd89Skb0pXIL6h44yX5uCHgEKa9.js):
  SHA-256 `ddd222dd162987fb80005717a07e29da85ac7677976278ad531cf365d6ceb8b9`.

These internal module names are observations, not supported integration APIs.
Phone-side rendering and any separate linked-device rename feature were not
inspected; the web evidence alone does not establish every iOS display rule.

## Experiments and result

The downloaded parser was executed offline in an isolated Node VM:

| Input                                  | Parsed browser / OS  |
| -------------------------------------- | -------------------- |
| Normal Edge UA                         | Edge / Windows       |
| Edge UA followed by `ChatPlus/version` | Edge / Windows       |
| `ChatPlus/version` followed by Edge UA | Edge / Windows       |
| ChatPlus-only product string           | Unrecognized / unset |

A separate fresh-browser comparison used the available Firefox runtime. Its
default UA reached login controls; the suffixed UA did not reach those controls
within the observation window. This is inconclusive for compatibility, and
neither run establishes the iPhone label or WebView2 behavior.

[WebView2 supports overriding the UA](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings2),
but Microsoft documents potential effects on Client Hints and associated workers.
No override was shipped: the tested truthful suffix does not change the parsed
Edge identity. No production code, profile or paired session was changed by this
investigation.
