/**
 * List the partitions of a setup version. The result is one row with `partitions` as a JSON array.
 */

call cdp.ml_setup_version_partition_list (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA'
);

call cdp.ml_setup_version_get (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA'
);
