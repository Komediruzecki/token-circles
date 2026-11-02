/**
 * The articles on about.tokencircles.com that the app links to, in one place. Each answers a
 * question a surface raises: Getting started's import step and the next step's, the months on
 * file, a month in the red, the first cushion. The surface names an `ArticleId`; this list turns
 * it into the address, so a renamed article changes here and nowhere else.
 *
 * The site keeps the other half: disjoint-colliders packages/tokencircles/src/pages/articles/, one
 * Markdown file per article, named by the last part of its path below. Its tests pin these three
 * files, so renaming one there fails until it is renamed here too.
 *
 * Pure, and used by both runtimes: the frontend links to them, and the Worker's day-2 mail does.
 */

/** The marketing site, where the articles and the legal pages live. */
export const ABOUT_SITE = 'https://about.tokencircles.com';

export type ArticleId = 'bank-year' | 'one-month' | 'first-cushion';

export interface Article {
  /** The article's headline, as the site shows it and a link to it reads. */
  title: string;
  /** Its path on the site, with the trailing slash the site serves it at. */
  path: string;
}

export const ARTICLES: Readonly<Record<ArticleId, Article>> = {
  'bank-year': {
    title: 'Getting a year out of your bank',
    path: '/articles/getting-a-year-out-of-your-bank/',
  },
  'one-month': {
    title: 'Why one month lies',
    path: '/articles/why-one-month-lies/',
  },
  'first-cushion': {
    title: 'Your first cushion',
    path: '/articles/your-first-cushion/',
  },
};

/** The article's full address. */
export function articleUrl(id: ArticleId): string {
  return `${ABOUT_SITE}${ARTICLES[id].path}`;
}
