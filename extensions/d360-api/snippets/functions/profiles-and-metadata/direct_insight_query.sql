/**
 * Query a calculated insight on the tenant host with dimensions, measures, a filter, a sort and a time grain. It is the tenant form of the insight query.
 *
 * The page size is `limit`, filter values are case-sensitive, and the default is 4,999 rows.
 */

call cdp.direct_insight_query (
    ci_name => 'Customer_Order_Summary__cio',
    dimensions => 'ssot__Id__c,Country__c',
    measures => 'Total_Spend__c',
    filters => '[Country__c=Germany]',
    order_by => 'Total_Spend__c DESC',
    time_granularity => 'MONTH',
    limit => 100,
    offset => 0
);
