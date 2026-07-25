# Security Policy

This is a portfolio demonstration, not an externally audited password manager. Do not store real
secrets in pre-release builds.

Please report suspected vulnerabilities privately to the repository owner. Include the affected
version, reproduction steps, impact, and any suggested mitigation. Do not include real passwords,
Recovery Kits, OAuth tokens, or vault data.

## Supported release

Only the latest tagged portfolio v1 artifact is supported. Browser-store availability, an
independent audit, and specific WebAuthn PRF combinations are not claimed until their external
release gates have evidence.

## Security boundaries

Vault content is encrypted and decrypted in the client. A compromised unlocked browser, malicious
or vulnerable dependency, endpoint malware, traffic metadata, JavaScript memory retention, and a
lost set of all recovery methods remain outside the guarantees. Clipboard clearing is best effort.
HIBP checks reveal a five-character SHA-1 prefix plus timing/network metadata, never the password.
