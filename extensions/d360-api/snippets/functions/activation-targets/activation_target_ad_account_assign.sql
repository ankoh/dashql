/**
 * Attach an ad account to an activation target in a data space, after you checked that it is free.
 *
 * Read `success` and `message` in the result. The spec's example sets the manager account to the same number as the account.
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
