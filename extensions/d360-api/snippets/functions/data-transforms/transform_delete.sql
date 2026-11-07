/**
 * Remove a data transform, which stops its scheduled runs.
 *
 * Read it first to be sure of the name. While the deletion runs the transform has the status `Deleting`, and afterwards a read fails with `ITEM_NOT_FOUND`. The docs don't say what happens to the target object or its rows.
 */

call cdp.transform_get (data_transform_name_or_id => 'account_summary');

call cdp.transform_delete (data_transform_name_or_id => 'account_summary');
