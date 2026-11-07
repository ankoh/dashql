/**
 * Read a model artifact. Take its developer name, which ends in `__mla`, from the list.
 */

call cdp.ml_model_artifact_list (model_type => 'Predictive', source_type => 'EdcNoCode');

call cdp.ml_model_artifact_get (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla');
