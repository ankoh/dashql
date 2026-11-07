/**
 * Retry a platform whose sync failed. Read the `error_code` of the platform first, then watch its status.
 *
 * Use it when `status` is `Error`. It is done when `status` leaves `Processing` for `Active` or `Error`.
 */

call cdp.activation_platform_get (id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');

call cdp.activation_platform_sync_retry (id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');
