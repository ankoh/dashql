/**
 * List the tasks a job is made of, to see which step of a run is the one that failed.
 */

call cdp.ml_job_get (job_id => '14qSB0000004C92YAE');

call cdp.ml_job_task_list (job_id => '14qSB0000004C92YAE');
