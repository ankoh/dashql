/**
 * Remove a webhook target that no data action needs any more.
 *
 * Read the target first to be sure it is the right one. Delete the data actions that point at it before, since the target can't go while they reference it. If the delete doesn't take effect, read the target again and check `status_error_code` for `DeleteFailed`.
 */

call cdp.dataaction_target_get (api_name => 'contact_webhook');

call cdp.dataaction_target_delete (api_name => 'contact_webhook');
