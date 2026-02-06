export function expandSelectedGroups(selectedGroups, taxonomy, scheduleRunGroups = []) {
  const selected = Array.isArray(selectedGroups) ? selectedGroups : []
  const expanded = new Set(selected.filter(Boolean))

  const aliasPatterns = taxonomy?.aliasPatterns || []
  const parentGroups = taxonomy?.parentGroups || []

  // Expand selected groups based on alias patterns
  expanded.forEach(group => {
    aliasPatterns.forEach(alias => {
      if (alias.pattern.test(group)) {
        (alias.groups || []).forEach(mapped => expanded.add(mapped))
      }
    })
  })

  // Expand parent/child relationships
  parentGroups.forEach(relation => {
    const { parent, children } = relation
    if (!parent || !Array.isArray(children)) return

    if (expanded.has(parent)) {
      children.forEach(child => expanded.add(child))
    }
    children.forEach(child => {
      if (expanded.has(child)) {
        expanded.add(parent)
      }
    })
  })

  // If schedule uses alias labels, map selected canonical groups to those labels
  scheduleRunGroups.forEach(label => {
    aliasPatterns.forEach(alias => {
      if (!alias.pattern.test(label)) return
      const aliasGroups = alias.groups || []
      const intersects = aliasGroups.some(group => expanded.has(group))
      if (intersects) {
        expanded.add(label)
      }
    })
  })

  return Array.from(expanded)
}
