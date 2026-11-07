/**
 * Read a prediction job definition: its model, input and output, and whether it is `Active`. Definitions start `Inactive`, so check this before you run one.
 */

call cdp.prediction_job_def_list ();

call cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
