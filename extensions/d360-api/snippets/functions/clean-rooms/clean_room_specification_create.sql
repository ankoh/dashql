/**
 * Map the attributes of a template to the DMO fields of your org, so you can create or accept a collaboration.
 *
 * Each `attribute_id` is an `id` from `configuration.memberConfigs[].attributeConfigs` of the template, and `collaboration_entity` is the central DMO of the mapping. `template_version_id` is the id of the template version.
 */

call cdp.clean_room_specification_create (
    name => 'sampleMapping',
    label => 'sampleMapping',
    dataspace_name => 'default',
    member_type => 'CONSUMER',
    owner_org_id => '00Dxx00QA6JqfVUEMZ',
    template_name => 'Overlap',
    template_version_id => '1TTxx0000004Cc4GAE',
    template_type => 'SALESFORCE',
    use_case_type => 'Overlap',
    data_mapping => (
        collaboration_entity = 'ssot__ContactPointEmail__dlm',
        attributes = [
            (
                attribute_id = 'SegmentId',
                alias = 'SegmentId',
                subject_attribute = (
                    object_name = 'ssot__ContactPointEmail__dlm',
                    object_label = 'Contact Point Email',
                    field_name = 'ssot__InternalOrganizationId__c',
                    field_label = 'Internal Organization'
                )
            ),
            (
                attribute_id = 'HashedEmailAddress',
                alias = 'HashedEmailAddress',
                subject_attribute = (
                    object_name = 'ssot__ContactPointEmail__dlm',
                    object_label = 'Contact Point Email',
                    field_name = 'ssot__DataSourceId__c',
                    field_label = 'Data Source'
                )
            )
        ]
    )
);

call cdp.clean_room_specification_list (order_by => 'created_date DESC', limit => 5);
