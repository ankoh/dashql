/**
 * Fetch the report of a finished deep research job as markdown.
 *
 * This is a read that uses POST. No source says what it returns before the job is `COMPLETED`, so check the status first.
 */

call cdp.deep_research_status_get (research_id => 'research-abc123');

call cdp.deep_research_report_get (research_id => 'research-abc123', output_format => 'markdown');
