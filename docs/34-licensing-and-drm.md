# 34 · Licensing and enforcement for a product whose code can be read

**Status: research for a decision (D-55). Nothing is built, and nothing will be until the alpha test is complete.**

Kushal's requirement (2026-10-20): the licence must be such that **only the developers can authorise who may use the software**, and use is **highly restricted outside the organisation**. That rules out every open-source licence (they let anyone use the code). It points to a **proprietary or source-available licence with no public grant at all**, plus a technical check that the licence is real.

**Read this first.** The web research for this document returned little on how Proxmox, Grafana, OpenVPN and GitLab enforce licences, so the "what they do" column below is **general knowledge written from memory and not checked in this session**; each line is marked *verify* and the product's own licensing page must be read before copying anything. The licence-text summaries (BSL, ELv2, FSL) come from search results. None of this is legal advice: the licence wording needs a lawyer.

---

## 1 · Two separate problems

| Problem | Question | Tool |
|---|---|---|
| **Legal** | Who is *allowed* to use or copy this? | The licence text and a signed agreement with each customer |
| **Technical** | Can the software tell whether *this* installation is allowed, and stop or limit it if not? | A signed licence key checked by the app |

The legal part is what actually stops a company that has the code. The technical part stops honest customers from drifting past what they paid for, and raises the effort for dishonest ones. **When the code is readable, nothing technical is unbreakable**: whoever has the source can remove the check. That is why products with readable code lean on the licence, the contract, and keeping the paid parts out of the shared code.

---

## 2 · What similar products do (general knowledge, verify)

| Product | Code | How it makes people pay | Enforcement style |
|---|---|---|---|
| **Proxmox VE** | Open (AGPL) | Free to run; a paid subscription gives the stable update repository and support | Soft: a "no valid subscription" reminder; access to the paid repository is keyed |
| **Grafana** | Open core (AGPL); a separate proprietary Enterprise build | Enterprise features need a licence file (a signed token) | Checked locally, with periodic refresh; features turn off when it lapses |
| **OpenVPN** | Open community edition; Access Server is proprietary | Access Server is limited by licence keys for the number of simultaneous connections | Hard limit on connections in the product |
| **GitLab** | Open core: Community and Enterprise editions | Paid tiers unlock features with a signed licence key | Features gated by the key |
| **Defguard** (from search) | Open source with paid enterprise features | Enterprise features stay disabled until a licence is activated; the open parts keep working | Feature-level |
| **Offline-key products** (from search) | Various | A key never disables the core; an expired key shows a banner | Honour system with a banner |
| **EmailEngine** (from search) | Source-available | The app stops 15 minutes after start without a valid key | Hard |

Sources: [monetising open source with a Pro tier](https://dodopayments.com/blogs/monetize-open-source-pro-tier), [Defguard enterprise licensing](https://docs.defguard.net/2.0/enterprise), [Cryptolens licensing models](https://help.cryptolens.io/licensing-models).

Pattern across them: **a free core, paid features behind a signed key, a soft nudge before a hard stop**. For this product the core would not be free (nothing is public), but the same key mechanics apply.

---

## 3 · Licence options and how they fit

| Option | What it is | Fits "only the devs authorise who can use it"? |
|---|---|---|
| **Proprietary, all rights reserved** (private repository, a written agreement per customer) | No public grant. Each customer gets a signed licence that names them, the number of seats and numbers, and the term | **Yes, exactly.** The default for software that is never published |
| **Source-available with a restrictive licence** (e.g. PolyForm Internal Use) | Code is readable; use is allowed only for the licensee's own internal business | Partly: it lets *anyone* who gets the code use it internally, so it does not give the developers control over who |
| **Business Source License (BSL)** | Readable code, production use restricted until a change date (at most four years), then it converts to open source | No: it is designed to become open |
| **Elastic License 2.0 / Functional Source License / SSPL** | Allow use and self-hosting; forbid offering the software as a competing hosted service | No: they let everyone run it |
| **Open source (AGPL, MIT, Apache)** | Anyone may use it | **No** |

Sources: [Elastic License 2.0](https://www.elastic.co/blog/elastic-license-v2), [Functional Source License](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/), [licence comparison](https://www.softwareseni.com/understanding-open-source-licenses-from-permissive-bsd-to-restrictive-business-source-license-and-sspl/).

**The fit is a proprietary licence, in practice two pieces of paper:** a *licence agreement* with each customer organisation (who, what, how long, no copying, no sharing, no reverse engineering, audit rights, termination), and a *copyright notice* in the repository. Keep the repository **private**. If customers ever receive code, give them a built package, not the source.

---

## 4 · How to enforce it technically

1. **A signed licence file.** The vendor holds a private key (Ed25519). The licence is a small signed token naming the organisation, the number of seats and numbers, the features, and an expiry. The product holds only the public key and verifies the token **offline**, so an air-gapped customer still works. Sources describe exactly this pattern, with the algorithm pinned so a token cannot pick its own.
2. **One check, used everywhere.** The seat and number limits and the "is this licence valid" check live in one function called by the API, by API keys, and by the gateway's send path (this is the plan in D-55).
3. **Soft before hard.** Warn at 14 days before expiry, then a grace period, then **read-only** (the inbox stays readable, sending stops). Never delete data because of a licence.
4. **Revocation.** A fully offline token cannot be revoked in real time. Options: short expiries renewed by a periodic online check (with a long offline grace), or a signed revocation list.
5. **Make tampering harder, not impossible.** Ship a bundled and minified build, not the source (see D-62, a single executable). A determined developer can still patch it, which is why the **contract** is the real protection.
6. **Hosted by us.** The strongest protection is not to hand over the code at all: we run it, the customer logs in, billing and licensing become one thing. Self-hosting for a customer then becomes a special, contractual case.

---

## 5 · Recommendation (to confirm)

1. **Licence:** proprietary, all rights reserved, private repository, a written agreement per customer organisation. No open-source or source-available public licence.
2. **Distribution:** **hosted by us first**; if self-hosting is ever allowed, deliver a built package only.
3. **Key:** an Ed25519-signed licence token checked offline, with limits for seats and numbers, an expiry, and a soft-then-read-only lapse. The operator override flag (D-47) is how a friendly customer is kept free.
4. **Do not rely on the code check.** Treat it as a convenience for honest customers; rely on the agreement.

### Open questions
- Will any customer ever run it on their own server, or is it hosted by us only?
- Do customers get the source to audit, under a non-disclosure agreement, or never?
- Which jurisdiction and which lawyer will write the agreement?
- Is the audience of the licence the *organisation* (most likely) or a named person?
