/**
 * Browse the platforms a target can be created on, with their `api_name`, category and whether they run batch or streaming. Reach for it first when setting up a destination.
 *
 * The `platform_type` here (`Strategic`, `Sfmc`, `S3`) isn't the one `activation_target_create` takes (`ExternalPlatform`, `SalesforceMarketingCloud`, `AmazonS3`). A `Strategic` platform such as Google Ads is created as `ExternalPlatform`.
 */

call cdp.activation_platform_metadata_list (
    platform_type => 'Strategic',
    dataspace => 'default',
    order_by => 'name asc',
    batch_size => 50
);
