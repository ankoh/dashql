/**
 * Get a calculated insight's values for one profile record on the tenant host. It takes only `fields`, so use the Connect form for dimensions, measures or time grains.
 */

call cdp.direct_profile_insight (
    data_model_name => 'Individual__dlm',
    id => '123',
    ci_name => 'Customer_Order_Summary__cio',
    fields => 'Total_Spend__c,Order_Count__c'
);

call cdp.direct_insight_metadata_get (ci_name => 'Customer_Order_Summary__cio');
