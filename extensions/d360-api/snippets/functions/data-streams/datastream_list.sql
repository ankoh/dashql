/**
 * List the data streams of the org, filtered by connector type. Use it to find the developer name or record id of a stream.
 *
 * Follow the next page rather than computing offsets, which count from 1. The list leaves out the field mappings even with `include_mappings`, so read a single stream when you need them.
 */

call cdp.datastream_list (filter => 'SFDC', limit => 50, order_by => 'DeveloperName', _pages => 3);
