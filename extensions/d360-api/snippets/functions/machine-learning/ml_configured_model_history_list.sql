/**
 * List the history snapshots of a configured model, to see how it changed over time.
 */

call cdp.ml_configured_model_history_list (
    configured_model_id_or_name => 'Attrition_Predictor_Catboost',
    limit => 25,
    offset => 0
);
