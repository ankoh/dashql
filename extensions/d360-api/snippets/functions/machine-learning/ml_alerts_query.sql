/**
 * Read the data alerts of a model artifact: findings made during training, such as `ObviousPredictor` or `CollinearFields`, and drift found at runtime. Each alert has `directives` that can be applied on a retrain.
 *
 * Despite the verb of the request this only reads. Accept or dismiss an alert with `ml_alert_update`.
 */

call cdp.ml_alerts_query (
    asset => 'Attrition_Risk_Predictor_v1__mla',
    asset_type => 'ModelArtifact',
    source_types => ['ModelTraining', 'Runtime']
);
