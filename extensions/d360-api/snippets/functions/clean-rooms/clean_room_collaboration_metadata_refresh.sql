/**
 * Ask a collaboration to refresh its metadata.
 *
 * `success` only means the refresh was initiated, and `errors` can hold an entry of empty strings on success. The spec documents no signal for the end, so read the collaboration afterwards.
 */

call cdp.clean_room_collaboration_metadata_refresh (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');

call cdp.clean_room_collaboration_list (filters => 'developer_name eq collab21_00DSB00000eMue3');
