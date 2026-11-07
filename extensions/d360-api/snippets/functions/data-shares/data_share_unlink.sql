/**
 * Stop exposing a data share to a target, for instance before deleting either of them.
 *
 * Unlinking a target that is already unlinked changes nothing. For a legacy Snowflake target, don't unlink until the new connection is verified, because downstream Snowflake processes can refer to the database it created.
 */

call cdp.data_share_unlink (
    name_or_id => 'Sales_Data_Share',
    data_share_target_names => ['BigQuery_Analytics_Target']
);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
