# Speech and likely questions

Outline for the management briefing (about 30 minutes). The full text for each slide is in the
deck’s speaker notes; this file holds the timings, the one line not to miss on each slide and the
answers to the most likely questions. Italian version: [discorso.md](discorso.md).

## Timing

| Part                                 | Slides | Minutes |
| ------------------------------------ | ------ | ------- |
| Opening and the ask                  | 1–2    | 2       |
| Problem, what it is, workflow        | 3–6    | 5       |
| Live demo ([demo.en.md](demo.en.md)) | 7      | 15      |
| Maintenance → numbers                | 8–12   | 4       |
| Pilot and next steps                 | 13–14  | 2       |
| Questions                            | 15     | rest    |

If time is short: in the demo skip G and H; of slides 8–12 keep only 9 (maintenance) and 12
(numbers).

## Slide by slide: the line not to miss

1. **Cover** — “I’ll tell you the ask right away, so you watch the demo knowing what to decide.”
2. **The ask** — “A two-week pilot, one team, one to three flows, measured with the team’s numbers,
   not mine.”
3. **Problem** — “Every release costs hours of manual regression and leaves scattered evidence.”
   The team’s number goes here: [hours of manual regression per release].
4. **What it is** — “One platform, self-hosted, for every kind of test.”
5. **Workflow** — “Create, organize, run, read, act: the demo follows these five steps.”
6. **Dashboard** — “Nobody has to ask where regression testing stands.”
7. **Demo** — switch to the script [demo.en.md](demo.en.md). Rule: no live debugging.
8. **Failure** — “Whoever fixes it doesn’t have to reproduce anything.”
9. **Maintenance** — “The run proposes the repair, a person approves it.”
10. **Integrations** — “It doesn’t ask anyone to change tools.”
11. **Security** — “Data doesn’t leave, and AI stays off until we turn it on.”
12. **Numbers** — “It’s not a prototype: what’s missing is the test with a real team.”
13. **Pilot** — “A single false green keeps the gate closed.”
14. **Next steps** — “I need a team, an operator, an environment and your go-ahead.”
15. **Questions** — repeat the ask in one sentence, then stop talking.

## Likely questions

**How much does it cost?**
No licence: the code is ours. The cost is infrastructure (a server or VM with Docker, PostgreSQL,
storage for evidence) and people’s time. A VM is enough for the pilot; the exact estimate depends on
the chosen environment: [infrastructure estimate]. Don’t compare with vendor prices you haven’t
verified.

**How much effort does it take to maintain?**
The platform has been in development since June 2025, with CI, two independent audits and a
complete manual. The pilot measures exactly this: how many locators need repair and how many fixes
are needed after recording. Before the pilot I won’t give made-up numbers.

**Who supports it if you’re not around?**
The code is documented (IT/EN manual, admin guide, runbooks), every change is a small, traceable
pull request, and CI blocks regressions. Choosing the second point of contact is part of the pilot:
[second point of contact].

**Why not a commercial tool?**
Because this one is self-hosted, data doesn’t leave, it covers web, API, mobile, BDD and load in one
place, and it adapts to our cases (like DMO on a closed network). The pilot exists precisely to
compare it with what the team uses today, on its own numbers.

**Is it secure? Who can see the data?**
Organizations isolated by the database itself, corporate SSO (OIDC or SAML), SCIM, roles, scoped
API keys, append-only audit log. AI assistance is off until an owner gives consent.

**Does it work with our applications behind a VPN?**
Yes: an agent runs inside that network and connects outbound to the platform. That’s the DMO case in
the demo (block H).

**What if the pilot goes badly?**
The report says why, with data. If the gate stays closed we stop, or fix and repeat the pilot on the
same flow. The decision is yours and stays recorded in the report.

**How much time does it take from the team?**
One operator for two weeks on one to three flows, plus the initial measurement of current times. I
install, prepare and observe.

## Placeholders to fill in beforehand

- [presentation date] — cover.
- [hours of manual regression per release] — slide 3 notes.
- [team name], [name], [server or VM] — slide 14.
- [infrastructure estimate], [second point of contact] — answers above.
