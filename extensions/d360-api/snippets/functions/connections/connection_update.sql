/**
 * Change the Marketing Cloud business units of a connection: add one to ingestion and map it to a data space, remove another.
 *
 * Only the passed data changes. A business unit in a data space mapping has to be configured for ingestion already or be added in the same call. Only `SalesforceMarketingCloud` is confirmed to work, other types are changed with `connection_replace`. An update can break dependent data streams.
 */

call cdp.connection_get (connection_id => '1WMX40000000IZdOAM');

call cdp.connection_update (
    connection_id => '1WMX40000000IZdOAM',
    connector_type => 'SalesforceMarketingCloud',
    add_ingestion_business_units => ['524002279'],
    remove_ingestion_business_units => ['524002280'],
    add_business_units_to_dataspaces => [(dataspace_name = 'default', mid = '524002279')]
);
