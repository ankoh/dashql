/**
 * Get the dimensions and measures of one calculated insight, before querying it. List the insights first if you don't know the name.
 */

call cdp.insights_metadata ();

call cdp.insights_metadata_get (ci_name => 'Customer_Order_Summary__cio');
