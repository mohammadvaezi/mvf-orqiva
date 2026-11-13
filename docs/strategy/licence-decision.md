<!-- [PCODE-223 | S15 | v0.1.0] T20.5 GA exit test (licence, team, backlog, first sprint without our help), launch checklist, licence decision memo -->

# Licence decision at GA (for the owner)

The 2027 plan leaves one decision for GA: does Orqiva stay proprietary, or does a source-available
Community edition open up? This page lays out the options. It is preparation for the owner's decision,
and not legal advice: the wording of any licence needs a lawyer.

## Where we stand (10 Oct 2026)

- `LICENSE` is a proprietary licence (all rights reserved; use only under a licence agreement or a paid
  subscription). The owner has not yet confirmed its wording (an open item in the plan since T01).
- Everything that ships is our own code, plus 18 permissive third-party packages
  (`docs/policy/licence-review-t19.md`). No third-party licence limits any option below.
- The product checks a signed licence key offline. Without one, it allows 5 people and every feature
  except the Enterprise ones (SAML, SCIM, audit export).

## The options

|                                      | A. Proprietary                                                                         | B. Source-available, opens later                                                                                                                                                             | C. Open core                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| What it means                        | As today: the code stays closed; free use up to 5 people                               | The code is readable, and use is limited (e.g. no competing service); each version becomes open source after two years (e.g. the Functional Source Licence, converting to Apache-2.0 or MIT) | An open-source core (e.g. Apache-2.0), plus closed Enterprise features in separate code |
| Can be undone                        | Yes: it can be opened later                                                            | No: the published versions stay open after their date                                                                                                                                        | No: the core stays open                                                                 |
| Trust for buyers (audits, regulated) | Through audits, the pen test and an escrow agreement                                   | Code can be read and audited directly                                                                                                                                                        | Core can be read and audited                                                            |
| Protection of the business           | Strongest                                                                              | Good for two years per version                                                                                                                                                               | Weakest: the core can be run by anyone, including a competitor's hosted service         |
| Licence key                          | The shipped JavaScript can be edited; only the licence terms forbid removing the check | The same, with the source public too                                                                                                                                                         | Only on the closed part                                                                 |
| Work before GA                       | None                                                                                   | Choose and review the licence; a contributor agreement if outside contributions are wanted; notices in every file and listing                                                                | Split the code into core and Enterprise; a separate build; contributor agreement        |
| Listings                             | All marketplaces accept it                                                             | All marketplaces accept it                                                                                                                                                                   | All marketplaces accept it                                                              |

Note: our policy forbids **shipping** third-party code under the BUSL, SSPL and similar licences. It does
not stop us from choosing such a licence for **our own** code; option B only needs to be written down as
an exception in `docs/policy/licences.md`.

## Recommendation

**Option A at GA, with a decision on option B after the first year.**

- It follows the plan's own principle: code can be opened later, but never closed again.
- The free tier for 5 people already serves the funnel the plan wanted from a Community edition. The
  plan's text describes a single-user edition with one project; the product allows 5 people and any number
  of projects. Decide which one is meant (see below).
- Regulated buyers who need to read the code can have an escrow agreement and the pen-test report.
- Revisit option B when the first-year target (about 40 paying teams) is in sight. Opening is a one-way
  door, so it is best taken with real sales data.

## What the owner decides

1. A, B or C.
2. The wording of `LICENSE`, reviewed by a lawyer, and the copyright holder's name. The `LICENSE` says
   _Farivarz_; the extension's publisher is _broszio_.
3. The free tier. The plan says "single user, one project", and the product today has 5 people and no
   project limit. The plan also names a minimum of 3 seats (the Team offer starts at 3) and a 14-day trial
   (which today exists only for cloud workspaces).
4. With option B or C: the conversion licence and its delay, and whether outside contributions are taken
   (they need a contributor agreement).
