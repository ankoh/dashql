/**
 * Read one partition of a setup version. List the partitions of the version first to find its id.
 */

call cdp.ml_setup_version_partition_list (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA'
);

call cdp.ml_setup_version_partition_get (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA',
    model_setup_partition_id => '14lSB0000000xK1YAI'
);
