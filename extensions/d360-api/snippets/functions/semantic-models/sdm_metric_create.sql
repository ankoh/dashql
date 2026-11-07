/**
 * Add a metric, a business KPI tracked over time. It names one measurement, one time field and the grains it may be viewed at, and can offer more dimensions as filters.
 *
 * Create it last in a build, since the fields it references must exist.
 */

call cdp.sdm_metric_create (
    model_api_name_or_id => 'AccountRevenue',
    name => 'Annual_Revenue_md',
    label => 'Annual Revenue',
    definition => (
        measurement_reference = (
            table_field_reference = (field_api_name = 'AnnualRevenue', table_api_name = 'Account')
        ),
        time_dimension_reference = (
            table_field_reference = (field_api_name = 'CreatedDate', table_api_name = 'Account')
        ),
        aggregation_type = 'Sum',
        time_grains = ['Month', 'Quarter', 'Year'],
        additional_dimensions = [
            (table_field_reference = (field_api_name = 'Region', table_api_name = 'Account')),
            (calculated_field_api_name = 'Revenue_Tier')
        ]
    )
);

call cdp.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
