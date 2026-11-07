/**
 * Start a deep research job whose plan is ready. The spec has no call that creates a job, so the id has to exist.
 *
 * It isn't finished while the status is `PENDING` or `RUNNING`. It ends as `COMPLETED`, `FAILED` or `CANCELLED`.
 */

call cdp.deep_research_run (research_id => 'research-abc123');

call cdp.deep_research_status_get (research_id => 'research-abc123');
