/**
 * Read one activation platform: its attributes, fields, identifiers, refresh settings and status.
 *
 * `status` is `Active`, `Error` or `Processing`, and `can_publish_now` tells whether it can be published. Credentials of the connector don't come back.
 */

call cdp.activation_platform_list (activation_platform_view => 'Developer', order_by => 'name ASC');

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
