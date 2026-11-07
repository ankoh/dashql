/**
 * Start training a setup version. This is the call that trains, with `status` set to `Training`, and it only works on the version id: a name is not accepted.
 *
 * Training is done when `status` in `_raw` of the version is `Published` or `Failed`. Only the status and the description can change here. To change the input, outcomes or fields, create a new version.
 */

call cdp.ml_setup_version_update (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA',
    type => 'EdcNoCode',
    status => 'Training'
);

call cdp.ml_setup_version_get (
    model_setup_id_or_name => 'Attrition_Risk_Predictor',
    model_setup_version_id => '14kSB0000005d8nYAA'
);
