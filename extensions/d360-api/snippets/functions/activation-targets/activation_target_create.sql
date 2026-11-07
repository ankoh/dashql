/**
 * Create an Amazon S3 destination for activations, which write the audience as CSV files into a bucket folder.
 *
 * The access key goes in `:s3_access_key` and the secret in `:s3_secret_key`. Wait until `status` of `activation_target_get` is `Active`, compared without case, before you create an activation on it. Its connector has more attributes than the spec's schema shows, depending on the platform.
 */

call cdp.activation_target_create (
    name => 's3_target2',
    dataspace_name => 'default',
    platform_type => 'AmazonS3',
    description => 'Nightly audience exports',
    connector => (
        name = 's3_conn_1',
        output_format = 'CSV',
        bucket_name = 'audience-exports',
        folder_name = 'nightly',
        access_key = :s3_access_key,
        secret_key = :s3_secret_key
    )
);
