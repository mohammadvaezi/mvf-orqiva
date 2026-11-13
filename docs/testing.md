<!-- [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close -->

# Test management

Every project has a **Test** tab. Cases live in the **Repository**, run in **Runs**, and come back as
**Coverage**, **Flaky**, **Bugs** and **Quality**. A case links to the task it checks. A result links to the
bug it became, the trace graph shows both, and a release can wait for them.

## Writing cases

A case has steps, each an action and what to expect.

- **Shared steps** are written once under **Repository → Shared steps** (signing in, opening the cart). Add
  them to a case with **Add shared steps**. Changing them changes every case that uses them. Shared steps
  that are still used cannot be removed.
- **Parameters** are names with values, such as `browser: chromium, webkit`. Write `<browser>` in a step; a
  run fills it from its configuration.
- **Given/When/Then**: a case of this type is written as Gherkin. Given and When are the actions; a Then,
  and the And or But after it, is what to expect. A Scenario Outline's Examples become its parameters.
  **Import a feature file** makes one case per scenario. Mistakes are named by line.
- **Test data** keeps the values tests need (test accounts, test cards) once per project, sealed like
  environment secrets. Write `{{data:admin.user}}` in a step. An open value is filled in when a run shows
  the steps. A sensitive value stays hidden until a tester reveals it in the runner, and Orqiva keeps who
  revealed it last.

## Running

**Plan a run** over a suite, all cases, or the cases a pull request touches ("Impacted by a pull
request"), once for each configuration you list.

- **Give each case to a tester** in the runner. **Workload** shows per person what is assigned, done,
  failing and left, and the time spent.
- **Results** are entered step by step, or with the keyboard: P pass, F fail, B block and S skip the next
  step; J and K move to the next or previous case. A timer counts the time on each case.
- **A failed or blocked result** can become a bug with the steps, the message and the evidence. A case
  blocked by a bug reopens by itself once the bug is done.
- **Ask the Tester agent what this is**: it says whether a failure is most likely a product bug, a test
  bug, the environment or a flaky test, how sure it is, and what to do next. **Triage n failures** asks
  about all of a run's failures at once.
- **Sign-off**: a run names who signs it off (an admin, when nobody is named). Once the run is finished,
  that person signs it off with a note. The results are then frozen as they stood.

## Imports and CI

**Import a report** takes a Playwright JSON report, a Cypress (mochawesome) JSON report, or the
`-result.json` files of `allure-results`. In CI:

```
orq test run -- npx vitest run --reporter=tap-flat    # streams TAP results
orq test import results.xml                           # JUnit
orq test import cypress/results/mochawesome.json      # Cypress
orq test import allure-results                        # an Allure folder
orq test impacted --base main                         # the cases covering what changed
```

## Quality

- **Defect leakage**: per release, the bugs its test runs caught against the bugs written after it shipped
  that no test found.
- **Burndown**: a release's planned cases, day by day, still to run and failing.

**Release policies** (Security → Policies) can stop a release unless every test of its tasks passes and a
test run is signed off.

## Privacy

Emails, phone numbers, IBANs, card numbers and test-data values are masked in test results, step notes,
imported messages and evidence notes before they are stored (a project or workspace setting, on by
default).

## Bug capture in the browser

The **Orqiva bug capture** extension for Chrome, Edge and Firefox files a bug from the page where it
happened. The bug includes a screenshot, the last console messages and network requests, the clicks and
typing before it (never the text typed), the browser and window, and a screen recording if one was made.
See `packages/capture/README.md` for building and installing it. It signs in with a personal API token.
