-- @description
-- Label the sentiment of case descriptions with the AI function `ai_sentiment`.
-- The AI functions are in beta and need the beta generative AI models of the org.
-- @end

with cases(case_id, description) as (
    values ('CS-1', 'Thanks a lot, the new release fixed everything for us!'),
           ('CS-2', 'This is the third time the export failed, we are very frustrated.'),
           ('CS-3', 'Can you tell me where to find the invoice for March?')
)
select
    case_id,
    description,
    ai_sentiment(description) as sentiment
from cases
order by case_id;
