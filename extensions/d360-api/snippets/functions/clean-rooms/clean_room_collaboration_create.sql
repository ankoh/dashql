/**
 * Start a collaboration on a template by inviting the other member.
 *
 * `provider_dev_name` and `specification_dev_name` are the `name` values of the provider and of your specification, not ids. `data_cloud_org_id` is the org where the clean room is enabled. The new collaboration is inactive until the invitation is accepted. Read it in the list afterwards.
 */

call cdp.clean_room_collaboration_create (
    label => 'collab21',
    description => 'Overlap of our email segments with the partner',
    dataspace_name => 'default',
    provider_dev_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462',
    specification_dev_name => 'sampleMapping',
    template_name => 'Overlap',
    template_version_id => '1TTxx0000004Cc4GAE',
    data_cloud_org_id => '00Dxx00nZbkbQgmEIE'
);

call cdp.clean_room_collaboration_list (order_by => 'created_date DESC', limit => 5);
