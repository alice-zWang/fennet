# Security Policy

Fennet keeps your notes on your own device. It has no servers, accounts database, ads, analytics or trackers, so
most security problems would come from the app itself: the web app, the iPad app, the lock, or the encryption used
for shared subjects. Reports about any of these are very welcome.

## Supported versions

Only the latest version gets security fixes.

| Version | Supported |
| --- | --- |
| Web app at https://alice-zwang.github.io/fennet/ (always the latest) | ✅ |
| Latest iPad app build | ✅ |
| Older builds and copies of the web app hosted elsewhere | ❌ |

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report privately through GitHub instead:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it (steps, a sample note or file if needed), what an attacker could do with
   it, and the browser or iPadOS version you used.

Please don't include real personal notes. Use made-up sample content instead.

### What to expect

- **Within 7 days:** a reply confirming the report was received.
- **About every 14 days:** an update on progress until it's resolved.
- **If accepted:** a fix as soon as practical (the goal is within 30 days for serious problems), then a public note
  about it once the fix is out. You'll be credited unless you'd rather not be.
- **If declined:** an explanation of why, for example if it's out of scope or can't be reproduced.

Fennet is a free project maintained by one person, so timelines are goals, not guarantees.

## What's in scope

- Reading, changing or deleting someone's notes without their permission
- Getting past the lock (Touch ID / Face ID / passcode) or Protected mode
- Weaknesses in how shared subjects are encrypted (AES-256-GCM with a passphrase-derived key)
- Script injection (XSS) through imported files, PDFs, images, shared notes or note content
- Ways around the Content Security Policy or the offline service worker
- Data leaving the device when the app says it doesn't

## What's out of scope

- Attacks that need a device that is already unlocked, jailbroken, or in the attacker's hands with its passcode
- Problems in third-party services you choose to connect (Apple iCloud Drive, or an AI provider using your own key)
- Social engineering, phishing, or denial-of-service attacks on GitHub Pages
- Missing security headers that GitHub Pages doesn't let the project control

## Good-faith research

If you make a good-faith effort to follow this policy, avoid harming other people's data or privacy, and give a
reasonable amount of time to fix the problem before sharing it publicly, no complaint will be made against you for
your research.
