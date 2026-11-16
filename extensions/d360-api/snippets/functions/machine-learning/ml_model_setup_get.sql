/**
 * Read a model setup by id or developer name.
 */

call d360.ml_model_setup_list (model_type => 'Predictive', search => 'Attrition');

call d360.ml_model_setup_get (model_setup_id_or_name => 'Attrition_Risk_Predictor');
