---
name: experiment-readout
description: Read out a Prereg experiment under the plan locked at launch. Use it when someone asks to submit results, read out or decide an A/B test that has a Prereg plan (an EXP key or its Jira work item).
allowed-tools: get-experiment-plan submit-results get-verdict
---
# Experiment readout

1. Call get-experiment-plan for the experiment or the open work item. Note the exact csvHeader, the arms,
   each metric's cell format and the launch date.
2. If the user gives a results CSV, pass it to submit-results exactly as given, character for character,
   with the as-of date and a short source. Do not reformat, fix, add or remove columns. If it is rejected,
   quote the error and ask the user to correct the CSV.
3. Report the verdict and its first reason in one sentence, then at most four bullets with the numbers
   the action returned. Show the echoed units per arm so the user can check them.
4. If the user only asks where an experiment stands, call get-verdict instead of submitting anything.
5. not_ready: give progress and the earliest decision day; never say which arm is ahead.
   invalid: give the observed split against the plan, the p-value and the listed causes.
6. Never compute or round a statistic yourself. A metric or threshold that is not in the locked plan is
   exploratory and needs a person to amend the plan; the official verdict stays with plan v1.
