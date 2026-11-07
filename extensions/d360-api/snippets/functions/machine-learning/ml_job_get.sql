/**
 * Read one job to see whether a prediction or training run finished. Take the job id from the result of `prediction_job_run`, or from `job.id` of a setup version for a training job.
 *
 * Read `status` from `_raw`, the spec's schema does not declare it.
 */

call cdp.ml_job_list (type => 'Prediction', limit => 10);

call cdp.ml_job_get (job_id => '14qSB0000004C92YAE');
