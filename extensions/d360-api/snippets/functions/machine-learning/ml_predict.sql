/**
 * Score rows against an enabled configured model right now. The request is synchronous, so use it to try a model on a few rows before you set up a prediction job.
 *
 * Name a configured model, not an artifact. Send at most 200 rows, each as long as `field_names` and in the same order, and write the values as strings. A row can fail on its own: read `status` of each entry in `predictions`, `Success` or `Error`.
 */

call cdp.ml_predict (
    model => (name = 'Attrition_Predictor_Catboost'),
    type => 'RawData',
    field_names => ['age', 'income', 'tenure_months'],
    rows => [['25', '50000', '12'], ['54', '120000', '240'], ['41', '78000', '96']],
    settings => (maxTopFactors = 3, maxPrescriptions = 5)
);
