/**
 * Define your own destination, here a CSV drop into an S3 bucket, with an email identifier that is hashed and an account id field.
 *
 * The S3 credentials go in `:s3_access_key` and `:s3_secret_key`. The server renames attributes and fields it creates, so read the names back before an update. Publish once `status` is `Active` and `can_publish_now` is `true`.
 */

call cdp.activation_platform_create (
    name => 'abc_user_identifiers',
    label => 'abc-user-identifiers',
    description => 'Activates only user identifiers',
    platform_type => 'Advertising',
    output_format => 'Csv',
    output_grouping => 'PerAccount',
    refresh_settings => (mode = 'Full', frequency = 'TwentyFourHours'),
    connector => (bucketName = 'example-bucket', exportDirectory = 'datacloud-activations'),
    custom_metadata => (connector_type = 'S3', access_key = :s3_access_key, secret_key = :s3_secret_key),
    activation_platform_attributes => [(
        name = 'EmailAddress',
        label = 'Hashed Email',
        destination_name = 'EmailAddress',
        object_name = 'ContactPointEmail',
        field_name = 'Email',
        is_required = true,
        apply_hash = true,
        is_identifier = true
    )],
    fields => [(name = 'AccountId', is_required = true, is_hidden = false, type = 'Text')],
    additional_metadata => (hash_method = 'SHA256')
);

call cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
