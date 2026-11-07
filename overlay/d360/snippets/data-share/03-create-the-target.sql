/**
 * Step 3 of the data share.
 *
 * Create the target that receives the share.
 */

call cdp.data_share_target_create (
    target_type => 'BigQuery',
    name => 'BigQuery_Analytics_Target',
    label => 'BigQuery Analytics',
    target_email_id => 'analytics-team@example.com',
    target_email_type => 'Group'
);
