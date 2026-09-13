# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ChatPlus Desktop, please report it responsibly by opening a [GitHub Security Advisory](../../security/advisories/new) rather than a public issue.

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested remediation

We will acknowledge your report within 72 hours and aim to provide a resolution or mitigation plan within 14 days.

---

## Security Considerations

ChatPlus Desktop is a desktop shell that loads the official Synology ChatPlus web interface inside a WebView2 window. The following security principles apply:

### Credentials

- **Never log Synology credentials.** The application must not write usernames, passwords, or session tokens to log files, the console, or any local storage outside of what the Synology ChatPlus web app itself manages.
- **Never commit Synology tokens or SynoToken values** to the source code or any configuration file tracked by version control.
- **Never send credentials to third parties.** All authentication data travels exclusively between the WebView2 instance and the user's own Synology NAS. No relay server, analytics service, or external endpoint should receive credentials.

### Network

- **Always use HTTPS** when connecting to your Synology NAS. Avoid HTTP connections, especially over networks you do not fully control. An attacker on the same network could intercept unencrypted credentials.
- **Private NAS URLs may contain sensitive infrastructure information.** Do not share your NAS address, QuickConnect ID, or DDNS hostname in public issues, screenshots, or log files. These URLs may reveal information about your home or organization's network.

### Theme Injection

- CSS injected by the theming system must only override visual properties (colors, backgrounds, borders). It must not execute JavaScript or exfiltrate data.

### Updates

- Only install releases from the [official GitHub Releases page](../../releases). Do not install binaries from untrusted sources.

---

## Scope

This security policy covers the ChatPlus Desktop application code. It does not cover Synology's own ChatPlus product or infrastructure. For vulnerabilities in Synology ChatPlus itself, please contact [Synology Security](https://www.synology.com/en-global/security/overview) directly.
