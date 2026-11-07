/**
 * Switch a collaboration off.
 *
 * There is no call that enables it again, so treat this as one-way. Read the collaboration first.
 */

call cdp.clean_room_collaboration_list (filters => 'developer_name eq collab21_00DSB00000eMue3');

call cdp.clean_room_collaboration_disable (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
