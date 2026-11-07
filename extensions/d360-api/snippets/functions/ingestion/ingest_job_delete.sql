/**
 * Delete a finished bulk job with its stored job data and metadata.
 *
 * The job has to be in `UploadComplete`, `JobComplete`, `Aborted` or `Failed`, so abort an open job first. Records that are already loaded are not mentioned by the docs.
 */

call cdp.ingest_job_get (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');

call cdp.ingest_job_delete (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
