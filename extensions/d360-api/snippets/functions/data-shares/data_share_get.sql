/**
 * Read a data share with the names of its objects, by API name or record id.
 *
 * Poll it after create, update or link until `status` is `Active`. Compare without regard to case, the spec's example has `PROCESSING`. `data_share_objects` holds a JSON object whose `names` array lists the objects. It doesn't show which targets the share is linked to.
 */

call cdp.data_share_list (limit => 20, offset => 0);

call cdp.data_share_get (name_or_id => 'Sales_Data_Share');
