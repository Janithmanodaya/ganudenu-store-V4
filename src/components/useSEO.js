import { useEffect } from 'react'

/**
 * Small helper to set SEO meta tags consistently.
 * Usage: useSEO({ title, description, canonical, ogImage })
 */
export default function useSEO({ title, description, canonical, ogImage }) {
  useEffect(() => {
    try {
      if (title) document.title = title
      const upsertMeta = (name, content) => {
        if (!content && content !== '') return
        let tag = document.querySelector(`meta[name="${name}"]`)
        if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', name); document.head.appendChild(tag) }
        tag.setAttribute('content', content)
      }
      const upsertProp = (property, content) => {
        if (!content && content !== '') return
        let tag = document.querySelector(`meta[property="${property}"]`)
        if (!tag) { tag = document.createElement('meta'); tag.setAttribute('property', property); document.head.appendChild(tag) }
        tag.setAttribute('content', content)
      }
      if (canonical) {
        let link = document.querySelector('link[rel="canonical"]')
        if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link) }
        link.setAttribute('href', canonical)
      }
      if (description) {
        upsertMeta('description', description)
        upsertProp('og:description', description)
        upsertMeta('twitter:description', description)
      }
      if (title) {
        upsertProp('og:title', title)
        upsertMeta('twitter:title', title)
      }
      if (canonical) {
        upsertProp('og:url', canonical)
      }
      if (ogImage) {
        upsertProp('og:image', ogImage)
        upsertMeta('twitter:image', ogImage)
      }
    } catch (_) {}
  }, [title, description, canonical, ogImage])
}