/**
 * List model setups, the parent records that group setup versions. Use it to find the setup to add a version to.
 *
 * The filters combine. `setup_type` is `EdcNoCode`, `OutOfTheBox` or `ModelConnector`.
 */

call cdp.ml_model_setup_list (
    model_type => 'Predictive',
    model_capability => 'BinaryClassification',
    setup_type => 'EdcNoCode',
    search => 'Attrition',
    limit => 50
);
