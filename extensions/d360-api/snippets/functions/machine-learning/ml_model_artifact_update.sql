/**
 * Enable or disable a model artifact, and change its label and description. The status is `Disabled`, `Draft` or `Enabled`.
 */

call cdp.ml_model_artifact_update (
    model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla',
    status => 'Enabled',
    label => 'Attrition Risk Predictor v1',
    description => 'Catboost model trained on the attrition data model object.'
);

call cdp.ml_model_artifact_get (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla');
