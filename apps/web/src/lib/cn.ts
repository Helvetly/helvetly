import { createCn } from 'cn/config'

// The type tokens (globals.css and site.css) are font sizes; without this, merging `text-body` with
// `text-foreground` treats both as colours and drops one.
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'caption',
            'body-sm',
            'body',
            'title-sm',
            'title',
            'page',
            'display',
            'lead',
            'headline',
            'hero',
            'subhero',
            'price',
            'wordmark',
          ],
        },
      ],
    },
  },
})
