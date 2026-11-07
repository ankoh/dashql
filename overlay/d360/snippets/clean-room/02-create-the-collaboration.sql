/**
 * Step 2 of the clean room.
 *
 * Invite the other member. `:provider_dev_name` comes from the previous step and `:data_cloud_org_id` is the org of the member. The `name` in the result is the `:collaboration_name` of the next steps.
 */

call cdp.clean_room_collaboration_create (
    label => 'collab21',
    provider_dev_name => :provider_dev_name,
    specification_dev_name => 'sampleMapping',
    template_name => 'Overlap',
    data_cloud_org_id => :data_cloud_org_id
);
