/**
 * Create a data lake object by hand, for the case a data stream does not create it for you. Check first whether a stream would: `datastream_create` usually makes the DLO.
 *
 * Give the name without the `__dll` suffix, you read it back as `Loyalty_Member__dll`, and a field `Member_Id` comes back as `Member_Id__c`. An `Engagement` DLO also needs `event_date_time_field_name`. Read it back and wait for the status to become active.
 */

call cdp.dlo_create (
    name => 'Loyalty_Member',
    label => 'Loyalty Member',
    category => 'Profile',
    dataspace_info => [(name = 'default')],
    data_lake_field_input_representations => [
        (name = 'Member_Id', label = 'Member Id', data_type = 'Text', is_primary_key = true),
        (name = 'Joined_On', label = 'Joined On', data_type = 'DateTime', is_primary_key = false)
    ]
);

call cdp.dlo_get (record_id_or_developer_name => 'Loyalty_Member__dll');
