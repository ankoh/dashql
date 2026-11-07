/**
 * Read one data share target, by API name or record id, to see its status.
 *
 * `status` is one of `Active`, `Deleting`, `Error`, `GrantRevokeAccess`, `InActive` and `Processing`. The type-specific fields such as `account_url` and `sub_type` are not columns, read them from `_raw`.
 */

call cdp.data_share_target_list (target_type => 'Snowflake');

call cdp.data_share_target_get (name_or_id => 'Snowflake_Prod_Target');
