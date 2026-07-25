# Security Invariants

These invariants are mandatory acceptance properties. A change that violates one requires stopping work and obtaining an explicit architecture/security decision; many are intentionally non-waivable.

## Key and encryption invariants

1. User vault decryption keys are generated/derived and used only in trusted clients.
2. Master password, Recovery Kit, and PRF outputs never reach server/BYOS/logs.
3. Root/compartment/item/transfer keys leave client memory only as authenticated wrapped/encrypted data.
4. Every persistent sensitive object is authenticated ciphertext before storage/network transfer.
5. Nonce/key reuse prohibited by construction and tests.
6. Encryption context binds purpose, vault/item/revision identity, and version to prevent substitution.
7. Unknown crypto/version/algorithm fails closed.
8. Decrypted content is schema-validated before use.
9. No custom cryptographic primitives.
10. Master-password change rewraps random keys; it does not make data directly password-encrypted.

## Recovery and session invariants

11. No server reset/escrow path can recover plaintext.
12. Recovery Kit independently restores every required compartment from BYOS state.
13. Sensitive compartment keys are not loaded by ordinary vault unlock.
14. Unsupported PRF clients fall back to master password/Recovery Kit, never an insecure substitute.
15. Browser restart locks the extension; worker restart cannot create an unauthorized session.
16. Revocation prevents future slot use after synchronization but is not marketed as retroactive erasure.

## Storage and sync invariants

17. BYOS canonical history is immutable encrypted revisions; snapshots are rebuildable hints.
18. No delivery order, duplication, retry, or stale snapshot silently loses a valid independent revision.
19. Unsafe concurrent edits produce conflict copies.
20. Tombstones are not collected before safe checkpoint/retention conditions.
21. Provider ETags/CAS are optimizations, not sole correctness assumptions.
22. Provider corruption cannot cause unauthenticated plaintext or silent acceptance.
23. The control plane is not required to unlock or read the local vault.

## Extension invariants

24. Page MAIN world never receives vault keys or unrelated item data.
25. Every extension message is schema-, sender-, tab-, frame-, origin-, and operation-validated as applicable.
26. Autofill does not silently cross an unapproved origin/RP boundary.
27. HTTP, opaque, sandboxed, and cross-origin frame fills are denied by default.
28. Native passkey fallback remains available; software passkeys do not silently downgrade RP security.
29. Permissions remain least-privilege and user-visible.

## Document invariants

30. Original bytes and hash are preserved separately from OCR/derivatives.
31. Preview/OCR/parsers do not fetch remote resources based on document content.
32. Plaintext thumbnails/indexes are not persisted.
33. OCR/classification output is untrusted until user-confirmed.
34. Redaction output is flattened/tested; hidden removed content is not retained.
35. Signature validity is distinct from signer trust, status, and claim truth.

## Credential invariants

36. Original credential bytes/token and exact profile version are preserved.
37. Format adapters do not convert ordinary documents into issuer-backed credentials.
38. Issuer signature, issuer identity, issuer authorization, status, holder binding, and purpose suitability are separate decisions.
39. No silent credential presentation.
40. Presentation shows requested/released claims and correlation handles before consent.
41. Remote credential resources are constrained, validated, cached, and consent/policy controlled.
42. SD-JWT is not described as fully unlinkable.
43. Unsupported attestation/mdoc/DC API/DigiLocker behavior remains disabled and clearly reported.

## Server and privacy invariants

44. D1/R2 never contain decryptable vault content or transfer secrets.
45. BYOS OAuth tokens/WebDAV credentials remain client-side.
46. Logs/telemetry contain no sensitive payloads, user origins, secrets, claims, filenames, or raw parser errors.
47. Secure Send keys remain in URL fragment/out-of-band and never reach server requests.
48. Relay expiry/deletion is not marketed as revoking downloaded copies.
49. Cloud AI/third-party OCR never receives document content.
50. Marketing/security UX accurately states zero-knowledge, verification, audit, and free-tier limitations.
