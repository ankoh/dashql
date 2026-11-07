/**
 * Enable a configured model, so that predictions can run against it. Read it afterwards to check `status` and `model_disabled_reasons`.
 *
 * Label and description can be sent with it to rename the model in the same call.
 */

call cdp.ml_configured_model_update (
    configured_model_id_or_name => 'Attrition_Predictor_Catboost',
    status => 'Enabled',
    label => 'Attrition Predictor (Catboost)',
    description => 'Scores the risk that an employee leaves within a year.'
);

call cdp.ml_configured_model_get (configured_model_id_or_name => 'Attrition_Predictor_Catboost');
