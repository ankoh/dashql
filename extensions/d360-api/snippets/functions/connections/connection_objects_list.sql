/**
 * List the source objects of a Marketing Cloud connection, narrowed to its data extensions.
 *
 * `filters` takes the properties `sub_type`, `mid` and `name`. For database connectors, pass `database` and `schema` in `advanced_attributes` instead, leaving them out can return a very large result. Omit `advanced_attributes` for non-database connectors.
 */

call cdp.connection_objects_list (
    connection_id => '1WMX40000000IZdOAM',
    filters => (
        filters_by_property = [
            (name = 'sub_type', filter_operator = 'EqualsOp', values = ['SalesforceMarketingCloudDataExtension']),
            (name = 'mid', filter_operator = 'EqualsOp', values = ['524002279'])
        ]
    )
);
