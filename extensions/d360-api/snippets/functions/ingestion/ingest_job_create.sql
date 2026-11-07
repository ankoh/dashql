/**
 * Open a bulk job that loads one object with upserts or deletes.
 *
 * The data stream has to exist already, and a job handles one object. The job starts `Open`, ready for uploads, and the `id` in the result is the one to upload to. An unused job stays open for up to 7 days. Mind the limit of 20 jobs per hour and 5 at once.
 */

call cdp.ingest_job_create (object => 'Orders', source_name => 'ecomm', operation => 'upsert');

call cdp.ingest_job_list (states => 'Open', limit => 20);
