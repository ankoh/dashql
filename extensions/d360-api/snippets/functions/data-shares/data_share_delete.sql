/**
 * Delete a data share that is unlinked and no longer needed.
 *
 * Unlink it from its targets first. Read the share before, and read it again afterwards: the status enum has `Deleting`, and the spec doesn't say whether the call returns before the share is gone.
 */

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');

call cdp.data_share_delete (name_or_id => 'Sales_Data_Share');
