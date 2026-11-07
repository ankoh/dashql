/**
 * Step 4 of bulk ingestion, closes the job `:job_id` of step 2 after the uploads of step 3.
 *
 * Data 360 only processes a job once it is closed.
 */

call cdp.ingest_job_update (id => :job_id, state => 'UploadComplete');
