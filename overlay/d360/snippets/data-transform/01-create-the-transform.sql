/**
 * Step 1 of a data transform. It reads the data model object `Account__dlm`.
 *
 * Write the accounts over one million in revenue into the new data lake object `Account_Summary__dll`.
 */

call cdp.transform_create (
    name => 'account_summary',
    label => 'Account Summary',
    description => 'Accounts over one million in revenue',
    type => 'BATCH',
    definition => (
        type = 'DCSQL',
        version = '1.0',
        manifest = (
            nodes = (
                account_summary_output = (
                    name = 'account_summary_output',
                    relation_name = 'Account_Summary__dll',
                    config = (materialized = 'table', writeMode = 'OVERWRITE'),
                    compiled_code = $$SELECT "Id__c", "Name__c" FROM "Account__dlm" WHERE "AnnualRevenue__c" > 1000000$$
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
                (name = 'Name__c', label = 'Account Name', type = 'Text', is_primary_key = false)
            ]
        )]
    )
);
