/**
 * Wrap a model artifact in a configured model, the object that predictions run against. Use it once a setup version is `Published`.
 *
 * Actionable fields are those prescriptions can be generated on. The model starts `Disabled`, send `status => 'Enabled'` to enable it right away, or do it later with `ml_configured_model_update`.
 */

call cdp.ml_configured_model_create (
    label => 'Attrition Predictor (Catboost)',
    description => 'Scores the risk that an employee leaves within a year.',
    artifact => (name = 'Attrition_Risk_Predictor_v1__mla'),
    capability => 'BinaryClassification',
    visibility => 'Shown',
    parameter_overrides => [(parameter_name = 'decisionThreshold', continuous_value = 0.5)],
    actionable_fields => [
        (name = 'Over_Time__c', type = 'ActionableVariable'),
        (name = 'Monthly_Income__c', type = 'TopFactor')
    ]
);

call cdp.ml_configured_model_list (model_type => 'Predictive', search => 'Attrition');
