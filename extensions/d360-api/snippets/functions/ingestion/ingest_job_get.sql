/**
 * Read one bulk job to see whether its processing finished.
 *
 * `state` is `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Failed` or `Aborted`. After `JobComplete`, allow at least 30 seconds before you query the data.
 */

call cdp.ingest_job_list (states => 'Open,UploadComplete', limit => 20);

call cdp.ingest_job_get (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
