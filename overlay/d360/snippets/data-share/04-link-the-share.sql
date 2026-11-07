/**
 * Step 4 of the data share.
 *
 * Link the share to the target.
 */

call cdp.data_share_link (name_or_id => 'Sales_Data_Share', data_share_target_names => ['BigQuery_Analytics_Target']);
