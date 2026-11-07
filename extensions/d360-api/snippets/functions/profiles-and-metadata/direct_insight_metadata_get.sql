/**
 * Get the dimensions, measures and relationships of one calculated insight on the tenant host. List the insights first for the name.
 */

call cdp.direct_insight_metadata ();

call cdp.direct_insight_metadata_get (ci_name => 'Customer_Order_Summary__cio');
