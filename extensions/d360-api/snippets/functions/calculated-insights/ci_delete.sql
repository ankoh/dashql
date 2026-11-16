/**
 * Remove a calculated insight.
 *
 * The deletion is asynchronous: the answer comes back at once, then the insight shows `DELETING` until a read returns `ITEM_NOT_FOUND`. Segments that filter on it break, and a semantic model that references it blocks the delete.
 */

call d360.ci_get (api_name => 'Customer_Order_Summary__cio');

call d360.ci_delete (api_name => 'Customer_Order_Summary__cio');
