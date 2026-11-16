/**
 * Delete a prediction job definition. Read it first to check which model and output it belongs to.
 */

call d360.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');

call d360.prediction_job_def_delete (prediction_job_def_id_or_name => 'attrition_scores');
