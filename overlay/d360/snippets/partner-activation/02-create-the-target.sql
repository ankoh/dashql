/**
 * Step 2 of activating to a partner.
 *
 * Point an activation target at one of them.
 */

CALL cdp.activation_target_create (name => 'google_ads_target', dataspace_name => 'default', platform_type => 'ExternalPlatform', connector => (name = 'PremiumPartnerGoogle', key_prefix_name = 'cdpactvstrgptnr'));
