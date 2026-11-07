/**
 * Step 6 of the order pipeline.
 *
 * Create the data model object `SalesOrders__dlm`, the schema that the insight and the segment read.
 */

CALL cdp.dmo_create (
  name => 'SalesOrders',
  label => 'Sales Orders',
  dataspace_name => 'default',
  category => 'Engagement',
  fields => [
    (name = 'OrderId', label = 'Order Id', is_primary_key = true, data_type = 'Text'),
    (name = 'IndividualId', label = 'Individual Id', is_primary_key = false, data_type = 'Text'),
    (name = 'TotalAmount', label = 'Total Amount', is_primary_key = false, data_type = 'Number'),
    (name = 'PurchasedAt', label = 'Purchased At', is_primary_key = false, data_type = 'DateTime')
  ]
);
