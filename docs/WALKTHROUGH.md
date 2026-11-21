# Prereg: installation and testing instructions for judges

> These are the testing instructions written for the Codegeist 2026 judges. To try the app yourself, first deploy your own copy (see the README). Where a step mentions the installation link from the submission form, use `forge install` on your own site instead, and replace `<your-app-id>` with the app ID that `forge register` gave you.

Prereg locks an A/B test's decision rule in Jira before the test launches. When results arrive, from the work item panel, the Rovo agent or an external AI analyst over MCP, Prereg's code (not a model) returns the verdict under that plan: **Ship**, **Don't ship**, **Inconclusive**, **Not ready** (no peeking before the planned sample and minimum days) or **Invalid** (sample ratio mismatch). Results can only be counts in the plan's exact columns, so nobody can add a metric or loosen a threshold after seeing the data.

## Requirements

- A Jira site where you are an admin. Confluence is optional (decision record, step 12). Rovo is optional (step 11).
- About 10 minutes for steps 1 to 10.
- For the Rovo step, a browser window at least 1,440 px wide, so the Rovo panel can open next to the work item.

## 1. Install (1 minute)

Open the installation link from the submission form, choose your site, select Jira (required) and Confluence (optional), and approve the scopes:

- `read:jira-work`, `write:jira-work`: read the experiment work items, write Prereg's issue property (for JQL and the glance), add comments, create the 6 sample work items;
- `storage:app`: experiments, plan versions and readouts;
- `read:page:confluence`, `write:page:confluence`, `read:space:confluence`: read an experiment brief and write the decision record page, as you.

Prereg calls no external services and uses no LLM of its own; Rovo does the language work.

## 2. Create a project (1 minute)

Create a Jira project named **Growth** with the key **GRO** (any template). The keys below assume a new project, where the sample work items become GRO-1 to GRO-6.

## 3. Load the sample data (1 minute)

Open **Apps > Prereg**, go to the **Settings** tab, choose **Growth (GRO)** under Sample data and click **Load sample data**. After about 30 seconds it says: "Created 6 work items (GRO-1 to GRO-6), 6 experiments and 6 readouts."

Everything is fictional. Dates are relative to the moment you load it, so the numbers below are the same on any day.

## 4. The portfolio

Open the **Experiments** tab. Expected:

| Work item | Verdict | Reason shown |
|---|---|---|
| GRO-1 Annual plan preselected | **Ship** | annual: checkout_conversion +12.48% [+5.17%, +19.80%], p = 0.000385; guardrails OK |
| GRO-2 Onboarding email sequence v2 | **Invalid** | sample ratio mismatch: 51.10% / 48.90% against 50/50, χ² = 48.13, p = 4.0e-12 |
| GRO-3 One-page checkout | **Not ready** | 58.9% of 108,060 units; day 6 of 14; 2 looks |
| GRO-4 Pro plan price $12 to $14 | **Don't ship** | checkout_conversion fell 10.00%; limit 5% |
| GRO-5 Trial-reminder subject line | **Inconclusive** | no detectable effect: best arm curiosity, Holm p = 0.0653 |
| GRO-6 Social proof on the sign-up page | **Draft** | 94,067 units planned (control 47,034, social_proof 47,034) |

Click **Open** on any row to see the full detail.

## 5. Search with JQL

In the work item search, run `preregVerdict in (ship, dont_ship) ORDER BY key`: it returns GRO-1 and GRO-4. `preregVerdict = invalid` returns GRO-2; `preregState = draft` returns GRO-6. Other fields: `preregExperiment`, `preregLift`, `preregLooks`.

## 6. Fix the invalid test (the key moment)

Open **GRO-2** and open its **Experiment** panel (the apps icon under the title, then Experiment). The panel shows **Invalid**, the observed split against the plan (χ² = 48.13, p = 4.0e-12) and a checklist of the usual causes, and **no lift at all**: the AI analyst's readout claimed +4.2%, but Prereg will not show effects from a broken split.

Click **Submit results**. Keep As of = today, set Source = `warehouse query v2` and Note = `bot sign-ups reached only control; v2 excludes them`, and paste:

```
arm,units,activation_7d,unsubscribe
control,48300,10890,212
sequence_v2,48233,10859,221
```

Click **Validate** ("The CSV matches plan v1. Units: control 48,300, sequence_v2 48,233."), then **Submit**. Expected:

- **RO-7: Inconclusive**, "no detectable effect: activation_7d −0.15% [−2.48%, +2.19%], p = 0.9025";
- sample ratio check OK (p = 0.8293);
- the unsubscribe guardrail OK (upper bound 0.0900 pp < 0.150 pp).

The +4.2% lift was an artifact of bot sign-ups that reached only the control arm.

## 7. Finish the not-ready test

Open **GRO-3**: **Not ready**, effects hidden, and "Earliest decision day 14 has passed: submit a final readout." Submit, as of today:

```
arm,units,checkout_conversion,refund_14d
control,55320,2489,52/2489
one_page,55180,2737,55/2737
```

Expected: **Ship one_page**, checkout_conversion **+10.24% [+4.40%, +16.08%], p = 0.000308**, refund guardrail OK. The glance on GRO-3 changes to **Prereg: Ship**.

## 8. Try to move the goalposts

On **GRO-5**, click Submit results and paste a CSV with an extra column:

```
arm,units,click_through,unsubscribe,open_rate
control,72000,7200,216,18000
curiosity,72000,7445,221,19100
deadline,72000,7430,230,18800
```

Expected: "Rejected, nothing stored": "`open_rate` is not in the locked plan v1 of EXP-5. Only these columns are accepted: arm, units, click_through, unsubscribe."

## 9. Guardrail veto and multiple arms

- **GRO-4:** revenue per visitor rose **+5.00%** (p = 0.0049, significant), but checkout conversion fell 10.00% and the one-sided lower bound of the drop (7.44%) is above the 5% margin agreed before launch: **Don't ship**.
- **GRO-5:** two treatments with raw p = 0.0327 and 0.0448. Holm's correction for two comparisons makes both 0.0653, so neither wins: **Inconclusive**. Without the correction, both would have looked like winners.

## 10. Draft and lock

Open **GRO-6**. Its panel shows the plan editor with "Sample size: 47,034 per arm". In **Primary metric**, change `mde 5%` to `mde 10%` and click **Update sample size**: "Sample size: 12,001 per arm". Click **Lock & launch**. The panel now shows "Plan v1, locked at launch on" today's date (UTC) and "Fingerprint" followed by 12 characters, and the verdict becomes **Not ready** ("No results yet."). Prereg also comments on the work item. From now on the plan can only change through an amendment.

## 11. Ask Prereg (Rovo, optional)

On **GRO-3**, click **Ask Prereg** in the panel, or open Rovo and choose the **Prereg** agent, and ask "Can we ship EXP-3?". The agent calls Prereg's get-verdict action and quotes its numbers; the wording varies.

- Before step 7: **Not ready**, 58.9% of 108,060 units, day 6 of 14, earliest decision day 14, and the units per arm. It does not say which arm is ahead, because the action does not return it.
- After step 7: **Ship** one_page, checkout_conversion +10.24% [+4.40%, +16.08%], refund guardrail OK.

To submit through the agent, paste a results CSV (for example the one from step 7) and ask it to submit it exactly as given, as of today. Rovo shows a review card; after **Confirm selected**, Prereg stores the readout, and the CSV SHA-256 shown in the panel matches the CSV you pasted.

## 12. Decision record (Confluence, optional)

On GRO-1 click **Write decision record**, enter a Confluence space key you can write to and click **Write page**. Prereg creates "Decision record: EXP-1 Annual plan preselected on the pricing page" as you, with plan v1 (launch date, fingerprint, arms, metrics), the verdict and its numbers, the guardrail status and the process (readouts, looks, amendments).

## 13. Amendment (optional)

On **GRO-5** click **Amend**, keep Field = alpha, enter `0.10` and the reason `looser threshold`, and click **Record amendment**. Expected: "v2 amended after launch. Official verdict: Inconclusive (v1). Exploratory under v2: Ship curiosity." The official verdict never changes; the amended result is labelled exploratory, and Prereg comments on the work item.

## 14. Closing without a Ship verdict

Move **GRO-4** to Done. Prereg comments once: "Prereg: EXP-4 was closed with the verdict Don't ship under plan v1. checkout_conversion fell 10.00%; limit 5%". It never blocks the transition.

## MCP (optional)

The `rovo:mcp` module exposes five tools: `list-experiments`, `get-experiment-plan`, `submit-results`, `get-verdict` and `compute-sample-size`. Locking and amending are deliberately not tools: only people in Atlassian lock or amend a plan.

External MCP clients connect to `https://mcp.atlassian.com/forge/<your-app-id>` after a site admin turns on Prereg's tools for external clients (Atlassian Administration > Apps > Sites > your site > Connected apps > Prereg) and the user approves the OAuth consent. Every call runs with the caller's own Jira permissions. The open-source `skill.md` in the submission text tells a third-party agent how to read out an experiment the Prereg way.

## Clean up

**Apps > Prereg > Settings > Remove sample data**, then confirm. It deletes the 6 sample work items, their experiments and readouts. Work items you created yourself are not touched.

## Privacy

- Every read and write for people runs as the current user; Confluence pages are read and written as the current user.
- Prereg stores experiments, plan versions and readouts (counts, a source label and a note) in Forge storage on your site. It stores no account IDs, names or email addresses.
- It writes one issue property, `prereg` (state, verdict, experiment, lift, looks), indexed for JQL.
- It calls no external services.
