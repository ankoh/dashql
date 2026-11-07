/**
 * Judge a trained model: AUC, gini, MCC, MSE, RMSE, confusion matrices at 100 thresholds, a gain table and the outcome distribution. Call it once the version is `Published`.
 *
 * `gauges` picks what to return, a comma-separated subset. It defaults to `Overview`.
 */

call cdp.ml_setup_version_inspector_metrics_get (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    version_id => '14kSB0000005d8nYAA',
    gauges => 'Overview,GainTable,FeatureImportances'
);
