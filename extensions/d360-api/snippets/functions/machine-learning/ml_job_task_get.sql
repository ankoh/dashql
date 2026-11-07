/**
 * Read one task of a job. List the tasks of the job first to find its id.
 */

call cdp.ml_job_task_list (job_id => '14qSB0000004C92YAE');

call cdp.ml_job_task_get (job_id => '14qSB0000004C92YAE', task_id => '14rSB0000000aB3YAI');
