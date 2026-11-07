/**
 * Step 2 of bulk ingestion, after step 1 accepted a record.
 *
 * Create the job. Its `id` in the result is the `:job_id` of the next steps.
 */

call cdp.ingest_job_create (object => 'Orders', source_name => 'ecomm', operation => 'upsert');
