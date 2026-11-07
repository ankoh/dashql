/**
 * Remove a configured model that nothing should score against any more. Read it first to see its status.
 *
 * The model artifact it wraps is not deleted with it.
 */

call cdp.ml_configured_model_get (configured_model_id_or_name => 'Attrition_Predictor_Catboost');

call cdp.ml_configured_model_delete (configured_model_id_or_name => 'Attrition_Predictor_Catboost');
