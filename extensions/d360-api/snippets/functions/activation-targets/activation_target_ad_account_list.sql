/**
 * List the ad accounts of a partner platform that no target in a data space has taken yet, to pick the one to assign.
 *
 * `platform_id_or_name` takes the `api_name` from `activation_platform_metadata_list`. An empty result can mean that all accounts are assigned. Check `has_error` and `errors` before you assign one.
 */

call cdp.activation_target_ad_account_list (
    activation_target_id => '85UVF000000NaQz2AK',
    dataspace => 'default',
    platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle'
);
