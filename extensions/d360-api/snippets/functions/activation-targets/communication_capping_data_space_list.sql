/**
 * List the data spaces that have communication capping definitions linked to activation targets.
 *
 * The columns are unsettled: if the known ones come back empty, the value is in `_raw`. Filters take `field eq value`.
 */

call cdp.communication_capping_data_space_list (
    filters => 'dataspace_name eq default',
    order_by => 'dataspace_name asc',
    batch_size => 50
);
