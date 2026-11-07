/**
 * Test the connection between the clean room and the provider's S3 bucket before you rely on it.
 *
 * A failed test is still an HTTP 200, so read `success` in the result. A failure carries an `error_code` and `details` with a `subErrorCode`.
 */

call cdp.clean_room_connection_test (
    consumer_org_id => '00D000000000001',
    connector_type => 'CleanroomAwsS3',
    connection_attributes => (
        authenticationOption = 'idp',
        bucketName = 'cleanroom-data-bucket',
        parentDirectory = '/shared-data/',
        iamRoleName = 'arn:aws:iam::123456789012:role/CleanroomDataAccessRole',
        externalId = 'app:DE809C7E:A1B2C3D4'
    )
);
