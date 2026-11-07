/**
 * Make a data share available to one or more targets.
 *
 * The share has to be `Active` first. Linking a target that is already linked changes nothing, so a retry is safe. `data_share_target_names` takes developer names only. Linking isn't always the last step: on the consumer side, such as Snowflake, there is usually something left to do.
 */

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');

call cdp.data_share_link (
    name_or_id => 'Sales_Data_Share',
    data_share_target_names => ['Snowflake_Prod_Target', 'BigQuery_Analytics_Target']
);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
