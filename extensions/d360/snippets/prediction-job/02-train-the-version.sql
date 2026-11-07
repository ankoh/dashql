/**
 * Step 2 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * Start the training of `:model_setup_version_id`.
 */

call cdp.ml_setup_version_update (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => :model_setup_version_id,
    status => 'Training'
);
