-- @description
-- Sort support cases into categories with the AI function `ai_classify`.
-- The AI functions are in beta and need the beta generative AI models of the org.
-- The categories have to be the same for every row, the text must not be null.
-- @end

with cases(case_id, subject) as (
    values ('CS-1', 'I was charged twice for my subscription'),
           ('CS-2', 'The app crashes when I open the settings'),
           ('CS-3', 'I cannot log in after resetting my password'),
           ('CS-4', 'Please add a dark mode')
)
select
    case_id,
    subject,
    ai_classify(subject, array['Billing', 'Technical Issue', 'Account Access', 'Feature Request', 'Other']) as category
from cases
order by case_id;
