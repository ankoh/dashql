/**
 * Get the values of a calculated insight for one profile record, such as the spend of one customer. The insight must be associated with the DMO.
 *
 * `offset` needs `order_by` on this route.
 */

call cdp.profile_insight (
    data_model_name => 'ssot__Individual__dlm',
    id => '100005',
    ci_name => 'Customer_Order_Summary__cio',
    dimensions => 'Country__c',
    measures => 'Total_Spend__c,Order_Count__c',
    time_granularity => 'QUARTER',
    order_by => 'Total_Spend__c DESC',
    batch_size => 100
);
