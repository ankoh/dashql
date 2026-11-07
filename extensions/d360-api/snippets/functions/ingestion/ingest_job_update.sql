/**
 * Close a bulk job so its uploaded data is queued for processing, or abort it.
 *
 * `UploadComplete` closes the job. `Aborted` deletes the uploaded data and the job is never processed. Either way no data can be added afterwards. After closing, read the job until `state` is `JobComplete` or `Failed`.
 */

call cdp.ingest_job_update (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab', state => 'UploadComplete');

call cdp.ingest_job_get (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
