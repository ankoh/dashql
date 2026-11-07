/**
 * List the model artifacts that training produced. Use it to find the artifact to wrap in a configured model.
 *
 * `source_type` tells models built with the no-code builder (`EdcNoCode`) from connected external models and Salesforce's own.
 */

call cdp.ml_model_artifact_list (model_type => 'Predictive', source_type => 'EdcNoCode', limit => 25);

call cdp.ml_model_artifact_get (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla');
