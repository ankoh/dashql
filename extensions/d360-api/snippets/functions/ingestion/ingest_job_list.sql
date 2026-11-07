/**
 * List the bulk jobs, here the ones that are still open or waiting to be processed.
 *
 * `states` takes a comma-separated list of `Open`, `UploadComplete`, `Failed`, `Aborted` and `JobComplete`. `limit` defaults to 20 and is 100 at most. The list leaves out `InProgress`.
 */

call cdp.ingest_job_list (states => 'Open,UploadComplete', limit => 100, offset => 0, order_by => 'system_modstamp');

call cdp.ingest_job_get (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
