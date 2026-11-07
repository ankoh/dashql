/**
 * Create a model setup, the parent record of setup versions. This is the first of three steps and starts no training: follow with `ml_setup_version_create`.
 *
 * Use `EdcNoCode` for the no-code training path. The outcome definition is only a hint, the outcome of each version is authoritative.
 */

call cdp.ml_model_setup_create (
    label => 'Attrition Risk Predictor',
    description => 'Predict whether an employee will leave the company.',
    model_type => 'Predictive',
    model_capability => 'BinaryClassification',
    setup_type => 'EdcNoCode',
    outcome_definition => (goal = 'Minimize', field_names = ['Attrition__c'])
);

call cdp.ml_model_setup_get (model_setup_id_or_name => 'Attrition_Risk_Predictor');
