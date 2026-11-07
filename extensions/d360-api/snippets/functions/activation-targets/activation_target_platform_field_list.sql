/**
 * List the target-level fields an external platform wants in `connector.field_config`, such as an account id.
 *
 * Match on `label`, not `name`: the examples send a field with label `AccountId` as `name = 'AccountId'`. Check against an org.
 */

call cdp.activation_target_platform_field_list (platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');

call cdp.activation_target_create (
    name => 'google_ads_target',
    dataspace_name => 'default',
    platform_type => 'ExternalPlatform',
    connector => (name = 'PremiumPartnerGoogle', key_prefix_name = 'cdpactvstrgptnr')
);
