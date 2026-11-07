/**
 * Decline an invitation to a collaboration.
 *
 * The call only starts the change; the invitation status in the collaboration list shows the outcome. There is no call that reopens a rejected invitation.
 */

call cdp.clean_room_collaboration_list (filters => 'developer_name eq collab21_00DSB00000eMue3');

call cdp.clean_room_invitation_reject (
    collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
    invitation_id => '1TOxx0000004D3UGAU'
);
