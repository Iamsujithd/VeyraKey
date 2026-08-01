# Apple Passwords extension benchmark

Date: 2026-07-27

## Purpose

This document translates Apple Passwords behavior and Apple's Liquid Glass guidance into
requirements for the browser extension. It is a benchmark, not permission to copy Apple
branding, proprietary artwork, or private system interfaces.

Chrome cannot render Safari's native Password AutoFill surface or Apple's system-owned
authentication sheets. The extension therefore aims for the same interaction principles:
field-level suggestions, explicit user consent, quiet prompts, local decryption, and a
separate full manager.

## What Apple Passwords provides

Apple's current Passwords experience includes:

- Passwords, passkeys, verification codes, Wi-Fi credentials, security recommendations,
  deleted items, and shared password groups.
- AutoFill across supported apps and websites, with credentials synchronized through
  iCloud Keychain.
- Strong-password generation during account creation.
- Compromised, weak, and reused-password warnings.
- Password history and recovery of recently deleted credentials.
- Explicit credential selection and, where configured, biometric or device authentication
  before a credential is released.
- Domain association checks intended to avoid suggesting a credential to the wrong site.

## Browser interaction model

Apple's interaction is contextual instead of modal:

1. A username or password field receives focus.
2. A compact suggestion appears next to the field or in the platform's AutoFill surface.
3. The user chooses a saved account.
4. Authentication is requested only when policy requires it.
5. The credential is filled and the user can submit the form.
6. After a successful new or changed login, the system offers to save or update it.

The browser extension should not open a large, fixed panel merely because a login page was
detected. Its in-page UI must remain anchored to the active field, stay available long
enough to interact with, and dismiss only through an explicit choice, navigation, or a
clear outside action.

## Liquid Glass design principles applied

Apple describes Liquid Glass as an adaptive material with optical depth, highlights, and
content-aware appearance. It is not a universal blur effect. The extension applies these
principles as follows:

- Use glass for compact controls and transient, field-level surfaces.
- Preserve a stable, legible background for larger management surfaces.
- Tint the main action selectively instead of coloring every control.
- Adapt to light and dark appearance.
- Retain strong borders, solid fallbacks, and readable contrast when reduced transparency
  is requested.
- Remove nonessential movement when reduced motion is requested.
- Use the platform system-font stack and compact, grouped controls.

## Current parity

| Capability | Current state |
| --- | --- |
| Detect username/password forms | Implemented, including dynamically inserted forms |
| Offer credentials at the active field | Implemented |
| Fill username and password after selection | Implemented |
| Capture new or updated credentials after submit | Implemented |
| Suggest a strong password during account creation | Implemented only for conservatively detected registration/new-password fields; current-password, login, reset, recovery, and change-password forms are excluded |
| Apple-compatible default password shape | Implemented: 20 characters, three readable groups, exactly 16 lowercase letters, one uppercase letter, one digit, and two hyphens |
| Respect website password rules | Implemented for HTML `passwordrules`, `minlength`, `maxlength`, patterns, and described requirements, with a site-adapted fallback |
| Other password options | Implemented: regenerate, no special characters when permitted, easy-to-type characters, or choose your own password |
| Encrypted contact/address identity profiles | Implemented, including explicit field-level selection for name, nickname, email, phone, organization, birth date, age, and address fields |
| Encrypted payment-card records | Implemented with strict bounded fields, independent item encryption, immutable revisions, search, sync, backup, and restore; payment-field AutoFill remains a protected-flow follow-up |
| Keep the save choice interactive across navigation | Implemented through extension service-worker state |
| Fill time-based verification codes | Implemented |
| Synchronize encrypted revisions through Google Drive app data | Implemented |
| Restore synchronized vault data on another device | Implemented; the user must connect the same Drive account and unlock locally |
| Local-only decryption | Implemented |
| Adaptive glass-like light/dark UI | Implemented |
| Reduced transparency and reduced motion | Implemented |
| Password health checks | Implemented locally, with automatic persisted HIBP status on save/update and an explicit manual retry |
| Cloud-first or local-only setup | Implemented; configured personal cloud is the default, local-only is optional, and migration remains available later |
| Native Safari/Apple AutoFill UI | Not available to Chrome extensions |
| Touch ID, Windows Hello, or security-key vault unlock | Implemented through capability-gated WebAuthn PRF; an intentional credential selection opens a compact sheet and starts verification immediately |
| Multi-account recommendation | Automatically resolves a unique exact username observed on the page and ignores blank malformed duplicates when a usable named login exists; genuinely ambiguous named accounts still require explicit selection |
| Locked username recommendations | A validated local-only index exposes credential ID, username, and exact HTTPS origin to the trusted extension context so the inline picker can show accounts before password release; it contains no password and never syncs to cloud storage |
| Liquid Glass-inspired interaction | A single floating functional layer uses live backdrop blur, restrained static edge highlights, depth, selective blue tint, and reduced-transparency/motion fallbacks; pointer-following spotlight effects are intentionally excluded and Chrome CSS cannot invoke Apple's proprietary system material |
| Biometric exact-origin AutoFill | Implemented as a fresh ceremony for every credential release, including while the manager session is already unlocked |
| Master-password AutoFill while the manager stays locked | Implemented in a protected extension-origin sheet that clears the submitted password and relocks after filling |
| Autofocused and replaced multi-step login fields | Implemented through focus, pointer, page-restore, visibility, and DOM-replacement observation |
| Fill and submit | Implemented as a separate explicit action; ambiguous forms fail closed |
| Native Apple Passwords sheet | Not available to Chrome; the extension invokes the browser/platform WebAuthn sheet |
| Native passkey provider integration | Future work |
| Password sharing groups | Future work |
| Wi-Fi password manager | Future work |
| Immutable password/item history and conflict-safe restore UI | Implemented |
| Browsable Recently Deleted retention view | Future work |
| Store submission only after confirmed login success | Needs broader site-specific heuristics; current capture is submit/navigation based |

## Extension information architecture

The design review resulted in three intentionally different surfaces:

1. **Browser action:** a compact controller that lists exact-origin account names only when
   matching encrypted logins exist, plus **Open Passwords**. It stays quiet on unmatched sites.
2. **Field-level surface:** the smallest transient credential or identity choice beside
   the focused field, followed by protected extension-origin verification.
3. **Passwords manager:** a dedicated page for search, health, sync, settings, and item
   management. The encrypted library is the default; add/edit fields appear only in a
   focused sheet after an explicit action.

This follows Apple's guidance to reserve popovers for a small amount of information or
functionality, keep important menu actions first, and treat glass as a functional layer
above content instead of applying blur to every container.

## Release acceptance criteria

- No credential is filled or saved without a direct user action.
- Suggestions are scoped to the normalized site origin and matching login records.
- Password text is never inserted into page HTML, URLs, logs, analytics, or error messages.
- The master password is entered only on the extension origin, never in page-owned or
  content-script DOM where the website could observe keyboard events.
- In-page UI remains usable on responsive layouts, single-page applications, shadow-DOM
  forms, and dynamically inserted login steps where browser permissions allow access.
- Extension reload, navigation, and service-worker suspension do not silently lose a
  pending save decision.
- Google Drive receives encrypted vault state only; decryption keys remain local.
- Automated unit, integration, package, and real-browser lifecycle tests pass before a
  release artifact is installed.

## Primary sources

- [Apple Passwords on iPhone](https://support.apple.com/guide/iphone/use-passwords-iph18e98624/ios)
- [Automatic strong passwords](https://support.apple.com/en-gb/guide/security/secc84c811c4/web)
- [Customizing Password AutoFill rules](https://developer.apple.com/documentation/security/customizing-password-autofill-rules)
- [Password AutoFill security](https://developer.apple.com/documentation/security/password-autofill)
- [AutoFill usernames and passwords in Safari](https://support.apple.com/guide/safari/autofill-usernames-and-passwords-ibrwf71ba236/mac)
- [Password security recommendations](https://support.apple.com/guide/security/password-security-recommendations-sec7aefe77c3/web)
- [Apple Passwords and iCloud Keychain security](https://support.apple.com/guide/security/password-security-sec1c89c6f3b/web)
- [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/)
- [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
- [Chromium origins that support WebAuthn](https://chromium.googlesource.com/chromium/src/+/main/content/browser/webauth/origins.md)
- [WebAuthn Level 3 PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension)
