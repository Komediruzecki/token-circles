/**
 * A link to one of the articles on about.tokencircles.com (shared/articles.ts), under the line
 * whose question it answers: the article's own title, with a page mark, opening in a new tab as
 * the legal links do, so the page the person is reading stays where it was.
 */
import { ARTICLES, articleUrl } from '../../../../shared/articles'
import styles from './ArticleLink.module.css'
import type { JSX } from 'solid-js'
import type { ArticleId } from '../../../../shared/articles'

/** A page with lines of text: an article, not a page of the app. */
const PageIcon = () => (
  <svg class={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6.25 8h4M6.25 10.5h4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export default function ArticleLink(props: { article: ArticleId; class?: string }): JSX.Element {
  return (
    <a
      class={`${styles.link} ${props.class ?? ''}`}
      href={articleUrl(props.article)}
      target="_blank"
      rel="noopener noreferrer"
      data-test-id="article-link"
      data-article={props.article}
    >
      <PageIcon />
      <span>{ARTICLES[props.article].title}</span>
      <span class={styles.hidden}> (article, opens in a new tab)</span>
    </a>
  )
}
