/**
 * Ask Data 360 to refresh the status of a transform.
 *
 * The answer holds only `success` and `errors`, not the status, so read the transform afterwards. For a streaming transform, don't follow `action_urls.refreshStatusAction`, which can point at a rebuild.
 */

call cdp.transform_status_refresh (data_transform_name_or_id => 'account_summary');

call cdp.transform_get (data_transform_name_or_id => 'account_summary');
