/**
 * Publish a platform you created so that targets can use it, and set its status to active.
 *
 * Check `can_publish_now` on the platform first. `success` and `message` report the call, so read `status` afterwards.
 */

call d360.activation_platform_get (id_or_name => 'abc_user_identifiers');

call d360.activation_platform_publish (id_or_name => 'abc_user_identifiers');

call d360.activation_platform_get (id_or_name => 'abc_user_identifiers');
