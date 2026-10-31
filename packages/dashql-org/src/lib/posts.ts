import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/// The published posts, newest first. Drafts are only listed by the dev server.
export async function getPosts(): Promise<Post[]> {
    const posts = await getCollection('blog', post => import.meta.env.DEV || !post.data.draft);
    return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
