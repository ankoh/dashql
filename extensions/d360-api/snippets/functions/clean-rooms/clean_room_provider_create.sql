/**
 * Register a provider that keeps its data in AWS and offers one custom template, an overlap of two segment tables.
 *
 * The template is a table layout for each side and a SQL query. `:threshold_count` in the query is a parameter that `clean_room_query_run` fills in. The SQL is a verbatim string.
 */

call cdp.clean_room_provider_create (
    label => 'package_AWS',
    description => 'AWS',
    provider_name => 'package_AWS',
    source => 'AWS',
    template_type => 'CUSTOM',
    source_configuration => (
        type = 'AWS',
        account_id = '041291292938',
        supported_regions = ['us-east-1', 'us-west-2']
    ),
    template_json => (
        name = 'Example1',
        description = 'Example of Clean Room Customized Templates',
        tables = (
            table_configs = [
                (
                    name = 'Provider',
                    role = 'Provider',
                    description = 'Provider table',
                    columns = [
                        (name = 'SegmentName', type = 'STRING', description = 'Name of the segment.'),
                        (name = 'MemberId', type = 'STRING', description = 'Member ID.'),
                        (
                            name = 'HashedEmailAddress',
                            type = 'HASHED_EMAIL',
                            description = 'Contact ID hashed with SHA256'
                        )
                    ]
                ),
                (
                    name = 'Consumer',
                    role = 'Consumer',
                    description = 'Consumer table',
                    columns = [
                        (name = 'SegmentId', type = 'STRING', description = 'Segment ID'),
                        (
                            name = 'HashedEmailAddress',
                            type = 'HASHED_EMAIL',
                            description = 'Contact ID hashed with SHA256'
                        )
                    ]
                )
            ]
        ),
        queries = (
            query_configs = [(
                name = 'QueryOverlap',
                use_case = 'Overlap',
                type = 'SQL',
                description = 'Overlap between consumers and providers.',
                source = $$
                SELECT Consumer.SegmentId AS Segment_Id__c,
                       Provider.SegmentName AS Provider_Segment_Name__c,
                       COUNT(DISTINCT Provider.MemberId) AS Matching_Population_Count__c
                FROM Consumer JOIN Provider ON Consumer.HashedEmailAddress = Provider.HashedEmailAddress
                GROUP BY Consumer.SegmentId, Provider.SegmentName
                HAVING COUNT(DISTINCT Provider.MemberId) >= :threshold_count
            $$,
                query_parameters = (
                    query_param_configs = [(
                        name = 'threshold_count',
                        type = 'INTEGER',
                        description = 'threshold_count'
                    )]
                ),
                referenced_tables = ['Consumer', 'Provider']
            )]
        )
    )
);
