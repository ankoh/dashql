/**
 * Classify a platform as third party, service provider or not applicable. The privacy type of every target on it is derived from this.
 *
 * The values are `ThirdParty`, `ServiceProvider`, `UpdateFailed` and `NotApplicable`; no source says what setting `UpdateFailed` means. Read the platform afterwards.
 */

call cdp.activation_platform_privacy_type_set (id_or_name => 'abc_user_identifiers', privacy_type => 'NotApplicable');

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
