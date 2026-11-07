/**
 * Step 4 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * Activate the job definition.
 */

call cdp.prediction_job_def_update (
    prediction_job_def_id_or_name => 'attrition_scores',
    activation_status => 'Active'
);
