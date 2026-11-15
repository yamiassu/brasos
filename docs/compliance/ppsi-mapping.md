# BrasOS requirements mapped to PPSI 2.0

Source: *Guia do Framework de Privacidade e Segurança da Informação, PPSI 2.0, versão 1.2, 30 Jan 2026* (SGD/MGI), read in full from the official PDF on gov.br/governodigital. Not legal advice; confirm with the customer's security officer.

**Licence caution.** The guide is CC BY-NC-ND 4.0 (no derivative works, non-commercial). This file cites measure *numbers* and uses our own wording. Do not paste guide text here. If BrasOS is a commercial product, get legal advice on how the framework may be used in documentation.

## How to read this

- PPSI 2.0 adopts CIS Controls v8.1 in full for security: controls **1–18**, 153 measures. **Control 0** is governance; **19–25** are privacy (LGPD).
- Measures are questions an *agency* answers about its own practices ("does the órgão do X?"). **An OS cannot be PPSI-compliant; it can make "yes" achievable and provide evidence.** So each row below is a product requirement that supports specific measures.
- Measures carry implementation groups GI1 < GI2 < GI3 (the agency's group depends on its size and risk). Plan: satisfy the GI1 and GI2 technical measures first; GI3 is a stretch.
- Status: **Conflict** = the current dev profile does the opposite. **Partial** = something exists. **None** = not started.

## Requirements

| ID | Requirement for the hardened profile | PPSI measures | Status | Today |
|---|---|---|---|---|
| R1 | No default credentials or accounts; admin duties on dedicated admin accounts; no passwordless root; MFA for administration | 4.7, 5.1, 5.4, 6.5 | **Conflict** | `brasos` has a default password and `NOPASSWD` sudo |
| R2 | An AI agent runs with a scoped privilege tier, never ambient root; every command it runs is attributable | 5.4, 6.1, 6.2, 6.8, 8.8 | **Conflict** | Claude Code runs as `brasos` with full sudo (by design, dev only). Tier is an open decision |
| R3 | Capabilities are default-deny, gated server-side per app, with a negative test for each | 6.7, 6.8, 3.3, 16.10 | Partial | `/pty` gated by app id + Origin; tested in `smoke.ts` |
| R4 | Tamper-resistant audit trail of privileged actions (app launch, capability grant/deny, terminal sessions, admin changes), synced clock, retention, central export | 8.1–8.5, 8.8–8.10, 3.14 | None | journald only; no app-level events |
| R5 | Secure baseline as code: minimal services, session lock, host firewall, no needless daemons | 4.1, 4.3, 4.4, 4.5, 4.6, 4.8 | Partial | Declarative NixOS config. NixOS enables its firewall by default (unverified in our image); no screen lock |
| R6 | SBOM generated from the exact image; allowlist of software and libraries; a published support lifecycle so agencies run only supported versions | 2.1, 2.2, 2.5, 2.6, 16.4, 16.5 | None | Nix closure exists; nothing exports it |
| R7 | Reproducible, pinned build; nothing fetched at runtime | 16.4, 16.5, 2.6 | **Conflict** | `bun install` runs from the network at boot |
| R8 | Update management with signed updates and rollback | 7.1–7.4, 7.7, 2.2 | Partial | NixOS rollback exists; no signing or update channel |
| R9 | Vulnerability management of our own closure and dependencies; severity triage; public reporting channel | 7.1, 7.2, 7.5, 7.7, 16.2, 16.6 | None | |
| R10 | Disk encryption at rest; TLS for any traffic leaving loopback; removable media encrypted. The guide points to FIPS 140-3 for crypto modules | 3.6, 3.9, 3.10, 3.11 | None | |
| R11 | Secure boot and measured boot (TPM) | no direct measure; supports 4.1, 4.6 | None | |
| R12 | App isolation by OS mechanisms (namespaces, seccomp, Landlock, MAC), not only by browser origin | 4.1, 10.5, 13.7, 16.10 | Partial | Origin-per-app iframes only |
| R13 | Endpoint protection decision: ship, integrate or document (antimalware, host intrusion detection) | 10.1, 10.2, 10.5, 10.7, 13.2 | None | Open decision |
| R14 | No listeners beyond loopback unless declared and filtered; secure protocols only | 4.4, 4.5, 12.6, 13.4 | Partial | Server binds `127.0.0.1` (contract 3) |
| R15 | Secure development lifecycle for BrasOS itself: threat model, code-level checks, root-cause analysis of vulnerabilities, reuse of validated modules, pentest readiness | 16.1, 16.3, 16.10–16.14, 18.1, 18.4 | Partial | `AGENTS.md` rules only; no threat model, no static analysis |
| R16 | Dev and hardened builds are separate profiles; prod never contains dev conveniences | 16.8 | None | Single dev profile |
| R17 | Data protection hooks: per-app storage separation, classification labels, retention, secure wipe | 3.2, 3.4, 3.5, 3.7, 23.7, 25.7 | None | |
| R18 | System and user-data recovery | 11.1–11.5 | Partial | Rollback only; no backup |
| R19 | Security events exportable to the agency's SIEM/ETIR | 13.1, 8.9 | None | |
| R20 | Identity integration: central accounts, MFA, and (to confirm) ICP-Brasil token/smartcard login | 5.6, 6.3–6.5, 6.7 | None | |
| R21 | Evidence export: baseline-check results (for example CIS Benchmark style) so the agency can show conformance | 4.1, 0.16 | None | |

## What agencies will ask us for as a supplier

Measures 15.4 (security terms in contracts), 16.4/16.5 (third-party components) and 2.2 (supported software only) mean an agency evaluating BrasOS needs: an SBOM, a support and end-of-life policy, patch timelines, a vulnerability disclosure process, and pentest evidence. Plan to produce these as artifacts, not just code.

## Outside the product (agency's own responsibility)

Control 0 (governance structures, POSIN, risk management, continuity), 14 (awareness and training), 17 (incident-management processes; we provide logs and contacts, they run the process), 18 (their pentest programme), and the organisational half of 19–25 (privacy governance, data-subject rights, contracts). BrasOS can help with evidence, not with these.

## Open questions

- Which bodies: federal (SISP, where PPSI applies directly) versus state, municipal or military?
- Is a formal certification demanded, or is PPSI conformance enough?
- AI agent privilege tier on a government machine (R2): forbidden, sandboxed, or allowed with audit?
- ICP-Brasil token login and digital signing in scope (R20, and DOC-ICP-10 homologation)?
- IN GSI/PR nº 9/2026 was added to the guide's reference norms in v1.1; its content was not read.
