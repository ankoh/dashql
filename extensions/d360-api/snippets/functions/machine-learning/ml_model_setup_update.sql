/**
 * Change the label, description, capability or outcome hint of a model setup. Send only what changes.
 */

call cdp.ml_model_setup_update (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    label => 'Attrition Risk Predictor',
    description => 'Predict whether an employee will leave within a year.',
    outcome_definition => (goal = 'Minimize', field_names = ['Attrition__c'])
);

call cdp.ml_model_setup_get (model_setup_id_or_name => 'Attrition_Risk_Predictor');
