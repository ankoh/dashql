/**
 * Step 3 of bulk ingestion, uploads to the job of step 2, whose `id` is `:job_id`.
 *
 * The first line of the CSV is its header, so it starts right after the opening quotes.
 */

call cdp.ingest_job_upload (id => :job_id, csv => $$id,total
o-1,77506
o-2,16986
$$);
