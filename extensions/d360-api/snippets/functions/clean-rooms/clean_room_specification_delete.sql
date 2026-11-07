/**
 * Remove a mapping you no longer need from the specifications of the org.
 *
 * Look at the list first to be sure of the name. The spec doesn't say what happens to a specification that a collaboration still uses.
 */

call cdp.clean_room_specification_list (order_by => 'created_date DESC', limit => 20);

call cdp.clean_room_specification_delete (specification_id_or_api_name => 'sampleMapping');
