import { createCn } from 'cn/config'

/**
 * Class joining and Tailwind conflict merging. The type scale's tokens (globals.css `--text-*`) are
 * font sizes: without this, `cn('text-body-sm', 'text-muted-foreground')` reads both as colours and
 * drops the size.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'body-sm', 'body', 'title-sm', 'title', 'page', 'display'] },
      ],
    },
  },
})
