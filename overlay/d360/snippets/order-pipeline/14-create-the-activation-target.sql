/**
 * Step 14 of the order pipeline.
 *
 * Create the S3 destination `s3_target`. Take `:activation_target_id` from the result of the first call, and repeat the second until `status` is `Active`.
 */

CALL cdp.activation_target_create (
  name => 's3_target',
  dataspace_name => 'default',
  platform_type => 'AmazonS3',
  connector => (
    name = 's3_conn_1',
    output_format = 'CSV',
    bucket_name = 'audience-exports',
    folder_name = 'nightly',
    access_key = secret(s3_access_key),
    secret_key = secret(s3_secret_key)
  )
);
CALL cdp.activation_target_get (activation_target_id => :activation_target_id);
