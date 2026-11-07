/**
 * Start a run of a data stream now, to ingest the source and refresh its data lake object. It is not for Salesforce CRM streams, which run on the connector's own schedule.
 *
 * The run is done when `last_run_status` of the stream is `SUCCESS`, `FAILURE` or `CANCELLED`, and not `PENDING`, `IN_PROGRESS` or `EXTRACTING`.
 */

call cdp.datastream_run (record_id_or_developer_name => 'Bike_Trips', interactive => false);

call cdp.datastream_get (record_id_or_developer_name => 'Bike_Trips');
