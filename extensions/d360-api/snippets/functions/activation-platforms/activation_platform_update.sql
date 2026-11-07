/**
 * Change the description and the refresh schedule of a platform: incremental every 24 hours, with a full refresh every 30 days.
 *
 * Only the fields you send change, except `activation_platform_attributes`, `fields` and `identifiers`, which replace the full set. Wait until `status` leaves `Processing`.
 */

call cdp.activation_platform_update (
    id_or_name => 'abc_user_identifiers',
    description => 'Activates only user identifiers',
    output_format => 'Csv',
    output_grouping => 'PerSegment',
    refresh_settings => (mode = 'Incremental', frequency = 'TwentyFourHours', periodic_full_refresh = 'Every30Days')
);

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
