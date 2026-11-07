/**
 * Read the rows of a calculated insight with chosen dimensions and measures, a filter and a sort. Reach for it when a calculated insight already holds the aggregate you want.
 *
 * A query returns at most 4,999 rows, so page with `offset`. Filter values are case-sensitive. Take the dimension and measure names from the insight metadata.
 */

call cdp.insights_query (
    ci_name => 'Customer_Order_Summary__cio',
    dimensions => 'ssot__Id__c,Country__c',
    measures => 'Total_Spend__c,Order_Count__c',
    filters => '[Country__c=Germany]',
    order_by => 'Total_Spend__c DESC',
    time_granularity => 'MONTH',
    batch_size => 500
);
