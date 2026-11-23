/** A count after a name in the Documents sidebar or Group by: small muted figures in the document-number font, flush right. */
export function Count({ children, label }: { children: number; label?: string }) {
  return (
    <span className="font-code ml-auto shrink-0 pl-2 text-caption text-muted-foreground">
      <span aria-hidden={label ? true : undefined}>{children}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
