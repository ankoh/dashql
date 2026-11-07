/**
 * Read one history snapshot of a configured model, as it was when the entry was recorded. Take its id from the history list.
 */

call cdp.ml_configured_model_history_list (configured_model_id_or_name => 'Attrition_Predictor_Catboost');

call cdp.ml_configured_model_history_get (
    configured_model_id_or_name => 'Attrition_Predictor_Catboost',
    history_id => '1QqSB0000004C92KAE'
);
