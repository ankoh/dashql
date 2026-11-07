/**
 * Step 5 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * Run the job.
 */

call cdp.prediction_job_run (type => 'Prediction', input => (name = 'attrition_scores'));
