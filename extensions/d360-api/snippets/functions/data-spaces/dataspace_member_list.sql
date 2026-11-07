/**
 * List the data lake objects that belong to a data space.
 *
 * Only DLOs are supported. Pages are chained with `continuation_token` from `_meta`, and no token means the last page. A token can expire, then restart from the first page. `status` can come back in upper case.
 */

call cdp.dataspace_member_list (id_or_name => 'default', batch_size => 200, order_by => 'ASC');

call cdp.dataspace_member_get (dataspace_member_object_name => 'Orders__dll', id_or_name => 'default');
