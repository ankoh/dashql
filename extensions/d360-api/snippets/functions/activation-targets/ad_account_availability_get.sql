/**
 * Check whether an ad account on a partner platform is still free in a data space, before you assign it to a target.
 *
 * It is true when the account isn't assigned yet. The check is per platform and data space, not per target. Here the account is `account_id`, while the assign call calls it `account_number`.
 */

call cdp.ad_account_availability_get (
    account_id => '6586160339',
    dataspace => 'default',
    platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle'
);

call cdp.activation_target_ad_account_assign (
    activation_target_id => '85UVF000000NaQz2AK',
    account_number => '6586160339',
    manager_account_id => '6586160339',
    dataspace => 'default'
);
