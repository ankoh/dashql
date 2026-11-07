/**
 * List the prediction job definitions, those of one model when you pass its id. Use it to find the definition to activate or run.
 */

call cdp.prediction_job_def_list (model_id => '12lSB000000UWdZYAW');

call cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
