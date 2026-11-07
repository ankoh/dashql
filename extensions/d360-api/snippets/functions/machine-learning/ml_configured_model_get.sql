/**
 * Read a configured model with its status and settings. Read `status` and `model_disabled_reasons` to see why a model is not usable.
 *
 * `filter_group` trims the properties: `Small` gives the essentials, `Medium` more, and `Big`, the default, everything.
 */

call cdp.ml_configured_model_list (model_type => 'Predictive', search => 'Attrition');

call cdp.ml_configured_model_get (
    configured_model_id_or_name => 'Attrition_Predictor_Catboost',
    filter_group => 'Medium'
);
