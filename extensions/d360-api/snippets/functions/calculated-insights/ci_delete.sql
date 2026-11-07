/**
 * Remove a calculated insight.
 *
 * The deletion is asynchronous: the answer comes back at once, then the insight shows `DELETING` until a read returns `ITEM_NOT_FOUND`. Segments that filter on it break, and a semantic model that references it blocks the delete.
 */

call cdp.ci_get (api_name => 'Customer_Order_Summary__cio');

call cdp.ci_delete (api_name => 'Customer_Order_Summary__cio');
