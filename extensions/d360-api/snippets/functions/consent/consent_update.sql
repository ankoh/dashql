/**
 * Record a data export request for a Data 360 profile: the profile is written to your S3 bucket. Use it to carry out a consumer rights request.
 *
 * Put the keys of the bucket in the parameters `:consent_s3_access_key` and `:consent_s3_secret_key`. For `portability` the bucket, the keys, the folder and the region are all required, and the status is `optin`. Check the `result` column of every row, since a 200 response can still contain errors.
 */

call cdp.consent_update (
    action => 'portability',
    ids => '100000695',
    mode => 'cdp',
    status => 'optin',
    aws_s3_bucket_id => 'acme-privacy-exports',
    aws_access_key_id => :consent_s3_access_key,
    aws_secret_access_key => :consent_s3_secret_key,
    aws_s3_folder => 'exports/individuals',
    aws_region => 'us-west-1'
);

call cdp.consent_get (action => 'portability', ids => '100000695', mode => 'cdp');
