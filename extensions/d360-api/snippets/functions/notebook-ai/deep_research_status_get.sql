/**
 * Check how far a deep research job is: its status, the plan and the progress of the run.
 *
 * `PENDING` and `RUNNING` mean it isn't finished. The plan and run details are JSON columns without a schema, the spec's examples show `currentStep`, `progress` and the plan steps.
 */

call cdp.deep_research_run (research_id => 'research-abc123');

call cdp.deep_research_status_get (research_id => 'research-abc123');
