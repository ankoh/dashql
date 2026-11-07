/**
 * Add a finished deep research report to a knowledge space, so later queries can use the findings. It lands in the `GENERATED_RESOURCES` library and is indexed.
 *
 * `report_file_path` is a short-lived sfdrive path, don't store it. No documented call returns it, and no source says how to watch the indexing finish.
 */

call cdp.deep_research_as_knowledge_source_add (
    knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM',
    research_id => 'research-abc123',
    report_file_path => '/sfdrive/temp/research-abc123-report.md',
    file_name => 'AI_Research_Trends_Report.md'
);
