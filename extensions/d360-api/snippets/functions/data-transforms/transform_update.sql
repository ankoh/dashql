/**
 * Replace a transform with a changed version, here a new description and weekly full runs.
 *
 * The call is a `PUT`, so it needs the whole body: read the transform first and send everything again, even what stays the same.
 */

call cdp.transform_get (data_transform_name_or_id => 'account_summary');

call cdp.transform_update (
    data_transform_name_or_id => 'account_summary',
    name => 'account_summary',
    label => 'Account Summary',
    description => 'Accounts over one million in revenue, refreshed daily',
    type => 'BATCH',
    dataspace_name => 'default',
    full_run_frequency => 'Weekly',
    definition => (
        type = 'DCSQL',
        version = '1.0',
        manifest = (
            nodes = (
                account_summary_output = (
                    name = 'account_summary_output',
                    relation_name = 'Account_Summary__dll',
                    config = (materialized = 'table', writeMode = 'OVERWRITE'),
                    compiled_code = $$SELECT "Id__c", "Name__c", "AnnualRevenue__c" FROM "Account__dlm" WHERE "AnnualRevenue__c" > 1000000$$
                )
            )
        ),
        output_data_objects = [(
            name = 'Account_Summary__dll',
            label = 'Account Summary',
            category = 'Profile',
            type = 'dataLakeObject',
            fields = [
                (name = 'Id__c', label = 'Account ID', type = 'Text', is_primary_key = true),
                (name = 'Name__c', label = 'Account Name', type = 'Text', is_primary_key = false),
                (name = 'AnnualRevenue__c', label = 'Annual Revenue', type = 'Number', is_primary_key = false)
            ]
        )]
    )
);
