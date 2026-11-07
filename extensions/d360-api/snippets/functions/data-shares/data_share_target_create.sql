/**
 * Create a target that a data share can be linked to, here a BigQuery principal.
 *
 * Each `target_type` takes its own attributes: BigQuery takes an email and its type (`Group`, `ServiceAccount` or `User`), Snowflake an `account_url`. The spec doesn't say how a target created through the API gets authenticated, so it may not work until someone finishes the sign-in in the UI. Read the target until `status` is `Active`.
 */

call cdp.data_share_target_create (
    target_type => 'BigQuery',
    name => 'BigQuery_Analytics_Target',
    label => 'BigQuery Analytics',
    dataspace_name => 'default',
    description => 'BigQuery target for analytics team',
    target_email_id => 'analytics-team@example.com',
    target_email_type => 'Group'
);

call cdp.data_share_target_get (name_or_id => 'BigQuery_Analytics_Target');
