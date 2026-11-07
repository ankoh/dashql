/**
 * Create a segment of the individuals who placed an order over 5000.
 *
 * Segment SQL is a dialect of its own: it goes in `include_dbt => (models = (models = [...]))`, and aliases or `EXISTS` are rejected. The segment starts as `PROCESSING`, so wait for `segment_status` to be `ACTIVE` before you publish. Any calculated insight it filters on has to be `ACTIVE` first.
 */

call cdp.segment_create (
    dataspace => 'default',
    developer_name => 'High_Value_Order_Buyers',
    display_name => 'High Value Order Buyers',
    description => 'Individuals with at least one order over 5000',
    segment_on_api_name => 'Individuals__dlm',
    segment_type => 'Dbt',
    publish_schedule => 'NoRefresh',
    include_dbt => (
        models = (
            models = [(
                name = 'high_value_order_buyers',
                sql = (
                    select distinct Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
                    from Individuals__dlm
                        join SalesOrders__dlm on Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
                    where (
                            Individuals__dlm.KQ_IndividualId__c = SalesOrders__dlm.KQ_IndividualId__c
                                or Individuals__dlm.KQ_IndividualId__c is null
                                    and SalesOrders__dlm.KQ_IndividualId__c is null
                        )
                        and trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
                        and SalesOrders__dlm.TotalAmount__c is not null
                        and SalesOrders__dlm.TotalAmount__c > 5000
                )
            )]
        )
    )
);

call cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');
