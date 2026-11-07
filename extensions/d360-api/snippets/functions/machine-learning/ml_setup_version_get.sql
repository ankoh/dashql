/**
 * Read one setup version. After training was started, `status` in `_raw` is `Published` or `Failed` when it is done.
 *
 * The version takes its id only, a name is not accepted. Find it in the list.
 */

call cdp.ml_setup_version_list (model_setup_id_or_name => 'Attrition_Risk_Predictor', limit => 10);

call cdp.ml_setup_version_get (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA'
);
