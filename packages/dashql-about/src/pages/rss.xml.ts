import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../lib/posts';

export async function GET(context: APIContext) {
    const posts = await getPosts();
    return rss({
        title: 'DashQL Blog',
        description: 'Everything we write about DashQL.',
        site: context.site!,
        items: posts.map(post => ({
            title: post.data.title,
            description: post.data.description,
            pubDate: post.data.date,
            link: `/blog/${post.id}/`,
        })),
    });
}
