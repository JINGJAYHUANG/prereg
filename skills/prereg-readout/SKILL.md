---
name: prereg-readout
description: Read out an A/B test the way the team pre-registered it in Jira, using the Prereg MCP tools. Use it when asked to analyse, read out or decide an experiment that has a Prereg key (EXP-12) or a Jira work item with a Prereg plan.
license: Apache-2.0
---
# Prereg readout

1. Call `get-experiment-plan` with the experiment or work-item key. Read `csvHeader`, `arms`, `metrics`
   (each metric's cell format and definition), `launchDate` and `plannedUnitsPerArm`.
2. Write the query in your own environment (warehouse, notebook) for exactly those columns and arms,
   for units assigned from `launchDate` up to the as-of date. Do not add metrics. Do not drop arms.
3. Build the CSV with the exact header. Proportions: successes, or successes/denominator.
   Means: mean|sd, or mean|sd|n.
4. Call `submit-results` with the CSV, the as-of date (YYYY-MM-DD) and a short `source`, such as your
   query name. Never compute or send p-values. Prereg computes them.
5. Report the returned verdict and reasons verbatim:
   - not_ready: report progress and the earliest decision day. Do not describe which arm is ahead.
   - invalid: report the sample ratio mismatch and check the listed causes in your query
     (bot filtering in one arm, redirects, logging loss, assignment bugs) before resubmitting.
   - ship / dont_ship / inconclusive: quote the lift, the interval and the guardrail statuses.
6. If the user wants another metric or threshold, explain that a person must amend the plan in Jira.
   The official verdict stays with the plan locked at launch.

Setup: install Prereg on your Atlassian site; a site admin enables its tools for external clients
(Atlassian Administration → Apps → Sites → your site → Connected apps → Prereg); connect your MCP client
to https://mcp.atlassian.com/forge/<your-app-id> and sign in. Every call runs with
your own Jira permissions.
