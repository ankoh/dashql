/**
 * Change a metric's label and definition, here by allowing the week grain and a filter that leaves out the smallest accounts.
 */

call cdp.sdm_metric_update (
    model_api_name_or_id => 'AccountRevenue',
    metric_name_or_id => 'Annual_Revenue_md',
    label => 'Annual Revenue (booked)',
    definition => (
        measurement_reference = (
            table_field_reference = (field_api_name = 'AnnualRevenue', table_api_name = 'Account')
        ),
        time_dimension_reference = (
            table_field_reference = (field_api_name = 'CreatedDate', table_api_name = 'Account')
        ),
        aggregation_type = 'Sum',
        time_grains = ['Week', 'Month', 'Quarter'],
        filters = [(field_name = 'AnnualRevenue', operator = 'GreaterThan', value = '10000')]
    )
);

call cdp.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
