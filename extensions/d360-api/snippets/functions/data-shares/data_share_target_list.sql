/**
 * List the data share targets of one type, for instance the Snowflake accounts a share can be linked to.
 *
 * `target_type` is required and there is no call for all types at once, so call it once per type. The type-specific fields are in `_raw`.
 */

call cdp.data_share_target_list (target_type => 'Snowflake');

call cdp.data_share_target_get (name_or_id => 'Snowflake_Prod_Target');
