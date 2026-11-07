/**
 * Step 3 of the clean room.
 *
 * The other member runs this in its own org. `:collaboration_name` comes from the previous step, `:invitation_id` from `members` of the collaboration, and `:specification_id` from `clean_room_specification_list`.
 */

CALL cdp.clean_room_invitation_accept (collaboration_id_or_api_name => :collaboration_name, invitation_id => :invitation_id, specification_id => :specification_id);
