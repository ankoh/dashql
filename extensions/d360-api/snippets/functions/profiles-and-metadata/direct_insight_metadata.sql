/**
 * List the calculated insights with their dimensions, measures and relationships on the tenant host. Then read one of them.
 */

call d360.direct_insight_metadata ();

call d360.direct_insight_metadata_get (ci_name => 'Customer_Order_Summary__cio');
