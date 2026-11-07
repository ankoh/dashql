/**
 * Run an active prediction job definition now: it scores the input object and writes the output object. The call returns before the run finishes.
 *
 * Take the job id from the result and read it until it is done. The definition must be `Active`, or the run is refused.
 */

call cdp.prediction_job_run (type => 'Prediction', input => (name = 'attrition_scores'));

call cdp.ml_job_list (type => 'Prediction', limit => 5);
