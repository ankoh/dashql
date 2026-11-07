/**
 * Edit the plan of a deep research job before it runs, either by instruction or by listing the steps.
 *
 * The job has to be pending, the spec doesn't say what happens once it started. The spec's example sends both `edit_instructions` and `plan` without saying which one wins.
 */

call cdp.deep_research_plan_update (
    research_id => 'research-abc123',
    edit_instructions => 'Focus more on recent developments in the last 6 months',
    plan => (
        steps = [
            (title = 'Literature Review', description = 'Review recent publications and research papers'),
            (title = 'Data Analysis', description = 'Analyze trends and patterns in the collected data')
        ]
    )
);

call cdp.deep_research_status_get (research_id => 'research-abc123');
