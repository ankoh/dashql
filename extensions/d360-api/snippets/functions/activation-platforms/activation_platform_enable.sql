/**
 * Switch a disabled platform on again, then read it to see that it is enabled.
 *
 * It takes the 18-character id or the API name.
 */

call cdp.activation_platform_enable (id_or_name => 'abc_user_identifiers');

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
