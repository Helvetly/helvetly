// English at the root URL: the same page as app/[lang], without the language segment.
export {
  default,
  generateMetadata,
  generateStaticParams,
} from '@/app/[lang]/help/topic/[topic]/page'

export const dynamicParams = false
