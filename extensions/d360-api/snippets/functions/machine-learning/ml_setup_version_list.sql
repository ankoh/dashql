/**
 * List the versions of a model setup, to find the id of the one to train, read or publish.
 *
 * Setup versions are keyed by their id only: a name is not accepted by the calls that follow.
 */

call cdp.ml_setup_version_list (model_setup_id_or_name => 'Attrition_Risk_Predictor', active => true, limit => 25);
