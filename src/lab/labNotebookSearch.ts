/** Small notebooks can search an in-memory index derived from durable records. */
export function matchesNotebookSearch(query: string, ...fields: (string | undefined)[]) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const text = fields.filter(Boolean).join('\n').toLocaleLowerCase()
  return terms.every((term) => text.includes(term.replace(/^#/, '')))
}
