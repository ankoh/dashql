/**
 * List every calculated insight with its dimensions and measures, to discover the insight names the query calls take.
 *
 * The result is one row, with all insights in its `metadata` array.
 */

call d360.insights_metadata ();

call d360.insights_metadata_get (ci_name => 'Customer_Order_Summary__cio');
