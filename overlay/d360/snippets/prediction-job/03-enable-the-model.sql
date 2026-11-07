/**
 * Step 3 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * Enable the configured model.
 */

CALL cdp.ml_configured_model_update (configured_model_id_or_name => 'Attrition_Predictor_Catboost', status => 'Enabled');
