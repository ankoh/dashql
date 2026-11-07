/**
 * Step 1 of the prediction job. It needs the model setup `Attrition_Risk_Predictor`, the configured model `Attrition_Predictor_Catboost` and the job definition `attrition_scores`.
 *
 * List the versions of the setup. The `id` of the one to train is the `:model_setup_version_id` of the next step.
 */

call cdp.ml_setup_version_list (model_setup_id_or_name => 'Attrition_Risk_Predictor');
