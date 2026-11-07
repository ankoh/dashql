/**
 * List the data spaces the caller is assigned to.
 *
 * A space that doesn't show up may still exist, since only assigned ones are returned. `limit` takes 1 to 4999 and `order_by` takes `ASC` or `DESC`.
 */

call cdp.dataspace_list (limit => 50, offset => 0, order_by => 'ASC');

call cdp.dataspace_get (id_or_name => 'default');
