/**
 * Remove the model artifact a training run produced. List the configured models that reference it first: predictive deletes do not cascade, and those models become orphaned.
 */

call cdp.ml_configured_model_list (
    asset_id_or_name => 'Attrition_Risk_Predictor_v1__mla',
    asset_type => 'ModelArtifact'
);

call cdp.ml_model_artifact_delete (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla');
