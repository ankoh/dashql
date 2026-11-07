/**
 * Accept an invitation to a collaboration with your own specification and say where the results of the queries go.
 *
 * The invitation id is `members[].invitationId` in the collaboration list, and the specification id is the `id` of your own specification. The call only starts the change: wait until the invitation shows as accepted and the collaboration is `Active` before you run a query.
 */

call cdp.clean_room_collaboration_list (order_by => 'created_date DESC', limit => 5);

call cdp.clean_room_invitation_accept (
    collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
    invitation_id => '1TOxx0000004CQoGAM',
    specification_id => '1TIxx0000004CH6GAM',
    output_configuration => (
        output_destination_type = 'EXTERNAL_CONNECTOR',
        external_id = 'ext12345678',
        connection_attributes = (
            connector_type = 'CleanroomSnowflake',
            account_url = 'https://your-account.snowflakecomputing.com/',
            warehouse_name = 'COMPUTE_WH',
            database_name = 'TEST_DB',
            schema_name = 'TEST_SCHEMA',
            service_user = 'CLEAN_ROOM_USER'
        )
    )
);
