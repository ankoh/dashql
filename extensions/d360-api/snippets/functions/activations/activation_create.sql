/**
 * Create a segment activation that sends the individuals of a segment to an activation target, with their id, an account name from a related object and their email address.
 *
 * `refresh_type` is the only field the spec requires, but the segment, the target, the subject and at least the id attribute are needed in practice. `RELATED` attributes need a query path from the activated DMO to their own. Read the result with `activation_get`.
 */

call cdp.activation_create (
    name => 'high_value_s3',
    dataspace_name => 'default',
    segment_api_name => 'High_Value',
    activation_target_name => 'S3_activation_target_test1',
    refresh_type => 'FULL_REFRESH',
    activation_target_subject_config => (developer_name = 'ssot__Individual__dlm'),
    attributes_config => (
        attributes = [
            (
                name = 'ssot__Id__c',
                label = 'Individual Id',
                entity_name = 'ssot__Individual__dlm',
                data_source_type = 'Text',
                reference_attribute_name = 'Id',
                preferred_name = 'individual_id',
                source = 'DIRECT',
                type = 'MODEL',
                query_path_config = (configs = [])
            ),
            (
                name = 'ssot__Name__c',
                label = 'Account Name',
                entity_name = 'ssot__Account__dlm',
                data_source_type = 'Text',
                reference_attribute_name = 'Name',
                source = 'RELATED',
                type = 'MODELRELATED',
                query_path_config = (
                    configs = [(
                        query_paths = (
                            query_path = [
                                (field_name = 'ssot__Id__c', object_name = 'ssot__Individual__dlm'),
                                (field_name = 'ssot__PartyId__c', object_name = 'ssot__Account__dlm')
                            ]
                        )
                    )]
                )
            )
        ]
    ),
    contact_points_config => (
        contact_points = [(
            type = 'EMAIL',
            entity_name = 'ssot__ContactPointEmail__dlm',
            attributes_config = (attributes = [(label = 'Email Address', name = 'ssot__EmailAddress__c')]),
            query_path_config = (
                configs = [(
                    query_paths = (
                        query_path = [
                            (field_name = 'ssot__Id__c', object_name = 'ssot__Individual__dlm'),
                            (field_name = 'ssot__PartyId__c', object_name = 'ssot__ContactPointEmail__dlm')
                        ]
                    )
                )]
            ),
            sources_config = (
                contact_point_sources = [(data_source_preference = 'ANY', data_source_priority = 1, name = 'Any')]
            )
        )]
    ),
    should_exclude_deletes => true
);
