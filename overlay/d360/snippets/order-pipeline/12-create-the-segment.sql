/**
 * Step 12 of the order pipeline, needs the relationship of step 8.
 *
 * Build the audience: individuals with at least one order over 5000. Segment SQL is its own dialect, see the Data 360 notes on Segment SQL.
 */

CALL cdp.segment_create (
  dataspace => 'default',
  developer_name => 'High_Value_Order_Buyers',
  display_name => 'High Value Order Buyers',
  description => 'Individuals with at least one order over 5000',
  segment_on_api_name => 'Individuals__dlm',
  segment_type => 'Dbt',
  publish_schedule => 'NoRefresh',
  include_dbt => (models = (models = [(
    name = 'high_value_order_buyers',
    sql = (
      SELECT DISTINCT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
      FROM Individuals__dlm
      JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
      WHERE (Individuals__dlm.KQ_IndividualId__c = SalesOrders__dlm.KQ_IndividualId__c
             OR (Individuals__dlm.KQ_IndividualId__c IS NULL AND SalesOrders__dlm.KQ_IndividualId__c IS NULL))
        AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
        AND SalesOrders__dlm.TotalAmount__c IS NOT NULL
        AND SalesOrders__dlm.TotalAmount__c > 5000
    )
  )]))
);
