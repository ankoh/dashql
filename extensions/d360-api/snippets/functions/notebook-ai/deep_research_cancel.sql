/**
 * Stop a running deep research job and ask for a partial report built from the steps that are done.
 *
 * Done when `status` is `CANCELLED`, in this answer or in the status. With `partial_report` the example returns a `report` with a `summary` and `sections`.
 */

call cdp.deep_research_status_get (research_id => 'research-abc123');

call cdp.deep_research_cancel (research_id => 'research-abc123', partial_report => true);
