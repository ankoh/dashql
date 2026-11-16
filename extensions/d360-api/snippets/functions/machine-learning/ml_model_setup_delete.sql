/**
 * Delete a model setup together with all its versions. Read it first to be sure it is the right one.
 */

call d360.ml_model_setup_get (model_setup_id_or_name => 'Attrition_Risk_Predictor');

call d360.ml_model_setup_delete (model_setup_id_or_name => 'Attrition_Risk_Predictor');
