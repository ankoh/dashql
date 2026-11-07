/**
 * Add an existing DMO to a model and expose only the fields you pick, instead of all of them. The source object must already exist.
 *
 * Here the object has chosen dimensions and measurements and a filter that limits the rows it contributes. `filter_logic` combines the filters by their 1-based index.
 */

call cdp.sdm_data_object_create (
    model_api_name_or_id => 'AccountRevenue',
    data_object_name => 'ssot__Account__dlm',
    data_object_type => 'Dmo',
    api_name => 'Account',
    label => 'Account',
    description => 'Customer accounts',
    table_type => 'Dimension',
    should_include_all_fields => false,
    semantic_dimensions => [
        (
            data_object_field_name = 'ssot__Id__c',
            api_name = 'Account_Id',
            label = 'Account Id',
            data_type = 'Text',
            is_primary_key = true
        ),
        (data_object_field_name = 'ssot__Name__c', api_name = 'Name', label = 'Account Name', data_type = 'Text'),
        (
            data_object_field_name = 'ssot__BillingCountry__c',
            api_name = 'Region',
            label = 'Region',
            data_type = 'Text',
            geo_role = 'Country'
        )
    ],
    semantic_measurements => [(
        data_object_field_name = 'ssot__AnnualRevenueAmount__c',
        api_name = 'AnnualRevenue',
        label = 'Annual Revenue',
        data_type = 'Currency',
        aggregation_type = 'Sum',
        decimal_place = 2
    )],
    filters => [
        (field_name = 'Region', operator = 'In', values = ['Germany', 'France', 'Spain']),
        (field_name = 'AnnualRevenue', operator = 'GreaterThan', value = '0')
    ],
    filter_logic => '1 AND 2'
);
