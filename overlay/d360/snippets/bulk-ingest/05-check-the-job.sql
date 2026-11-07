/**
 * Step 5 of bulk ingestion, reads the job `:job_id` of step 2.
 *
 * Repeat until `state` is `JobComplete` or `Failed`.
 */

CALL cdp.ingest_job_get (id => :job_id);
