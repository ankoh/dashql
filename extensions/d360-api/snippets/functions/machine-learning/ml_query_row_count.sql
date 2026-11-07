/**
 * Count the rows of a data source after a filter, to check that there is enough data to train. The platform needs at least 400 rows after filters and joins.
 */

call cdp.ml_query_row_count (
    input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
    filter => (
        criteria = [(
            filter_field = (name = 'Monthly_Income__c', source = 'Attrition__dlm', type = 'DataModelObject'),
            operator = 'GreaterThan',
            values = [(value = '1000', type = 'Constant')]
        )],
        conjunctive_operator = 'And'
    )
);
