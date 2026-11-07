/**
 * List the data shares of the org, ordered by developer name, to find the one to work on.
 *
 * Page with `limit` and `offset`.
 */

call cdp.data_share_list (limit => 20, offset => 0);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
