/**
 * Delete an activation platform that nothing uses any more. Read it first to be sure it is the right one.
 *
 * A platform that activation targets or segment activations still reference returns a 412. To find those, filter `activation_target_list` by `platformName`, which holds the label and not the API name.
 */

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');

call cdp.activation_platform_delete (id_or_name => 'abc_user_identifiers');
