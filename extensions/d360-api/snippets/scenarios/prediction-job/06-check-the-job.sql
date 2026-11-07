/**
 * Step 6 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * Read `last_run_status`.
 */

call cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
