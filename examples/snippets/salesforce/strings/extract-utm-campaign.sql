/**
 * @description
 * Extract the UTM campaign from landing page URLs with `regexp_substr`, it returns null without a match.
 */

with page_views(view_id, url) as (
    values ('V-1', 'https://example.com/shoes?utm_source=mail&utm_campaign=spring_sale'),
           ('V-2', 'https://example.com/?utm_campaign=newsletter-42&utm_medium=email'),
           ('V-3', 'https://example.com/about'),
           ('V-4', 'https://example.com/shoes?utm_campaign=spring_sale')
)
select
    split_part(regexp_substr(url, 'utm_campaign=[^&]+'), '=', 2) as campaign,
    count(*) as views
from page_views
group by campaign
order by views desc;
