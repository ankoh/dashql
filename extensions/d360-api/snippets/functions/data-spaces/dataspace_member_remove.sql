/**
 * Take data lake objects out of a data space.
 *
 * `member_names` is one string with the DLO names separated by commas, at most 10. A successful response doesn't mean every member went: single items can fail, for instance when something depends on them. Confirm with the member list.
 */

call cdp.dataspace_member_remove (id_or_name => 'nonDefault', member_names => 'Orders__dll,Returns__dll');

call cdp.dataspace_member_list (id_or_name => 'nonDefault', batch_size => 200);
