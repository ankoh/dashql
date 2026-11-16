/**
 * Read one data space by its API name or record id.
 *
 * `status` is `Active`, `Error` or `Processing`.
 */

call d360.dataspace_list (limit => 50, order_by => 'ASC');

call d360.dataspace_get (id_or_name => 'default');
