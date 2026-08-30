import type {
  LabNotebookObjectType,
  LabNotebookOrganization,
  LabTopic,
  LabTopicLink,
} from './labTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Topic names are forgiving about surrounding whitespace and letter case. */
export function normalizeLabTopicName(name: string) {
  return name.trim().replace(/^#+/, '').trim()
}

export function findLabTopic(topics: readonly LabTopic[], name: string) {
  const normalizedName = normalizeLabTopicName(name).toLowerCase()
  return topics.find((topic) => normalizeLabTopicName(topic.name).toLowerCase() === normalizedName)
}

/** An absent v1 organization record means an empty list, not a notebook reset. */
export function normalizeLabOrganization(value: unknown): LabNotebookOrganization {
  const record = isRecord(value) ? value : {}
  const topics: LabTopic[] = []
  const topicIds = new Map<string, string>()

  for (const entry of Array.isArray(record.topics) ? record.topics : []) {
    if (!isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.name !== 'string'
      || typeof entry.createdAt !== 'string') continue

    const id = entry.id.trim()
    const name = normalizeLabTopicName(entry.name)
    if (!id || !name || topicIds.has(id)) continue

    const existing = findLabTopic(topics, name)
    topicIds.set(id, existing?.id ?? id)
    if (!existing) topics.push({ id, name, createdAt: entry.createdAt })
  }

  const topicLinks: LabTopicLink[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(record.topicLinks) ? record.topicLinks : []) {
    if (!isRecord(entry)
      || (entry.objectType !== 'note' && entry.objectType !== 'artifact')
      || typeof entry.objectId !== 'string'
      || typeof entry.topicId !== 'string') continue

    const objectId = entry.objectId.trim()
    const topicId = topicIds.get(entry.topicId.trim())
    if (!objectId || !topicId) continue

    const key = JSON.stringify([entry.objectType, objectId, topicId])
    if (seen.has(key)) continue
    seen.add(key)
    topicLinks.push({ objectType: entry.objectType, objectId, topicId })
  }

  return { topics, topicLinks }
}

/** Changes relationships for just one object; its note/file is never removed. */
export function setLabObjectTopics(
  organization: LabNotebookOrganization,
  objectType: LabNotebookObjectType,
  objectId: string,
  topicIds: readonly string[],
): LabNotebookOrganization {
  if (!objectId.trim()) return organization
  const validIds = new Set(organization.topics.map((topic) => topic.id))
  const selectedIds = [...new Set(topicIds)].filter((id) => validIds.has(id))
  const currentLinks = organization.topicLinks.filter((link) => (
    link.objectType === objectType && link.objectId === objectId
  ))
  if (currentLinks.length === selectedIds.length
    && new Set(currentLinks.map((link) => link.topicId)).size === currentLinks.length
    && currentLinks.every((link) => selectedIds.includes(link.topicId))) return organization

  return {
    topics: organization.topics,
    topicLinks: [
      ...organization.topicLinks.filter((link) => (
        link.objectType !== objectType || link.objectId !== objectId
      )),
      ...selectedIds.map((topicId) => ({ objectType, objectId, topicId })),
    ],
  }
}

export function labObjectHasTopic(
  topicLinks: readonly LabTopicLink[],
  objectType: LabNotebookObjectType,
  objectId: string,
  topicId: string,
) {
  return topicLinks.some((link) => (
    link.objectType === objectType && link.objectId === objectId && link.topicId === topicId
  ))
}

function linksByObject(links: readonly LabTopicLink[]) {
  const objects = new Map<string, Set<string>>()
  for (const link of links) {
    const key = JSON.stringify([link.objectType, link.objectId])
    const topicIds = objects.get(key) ?? new Set<string>()
    topicIds.add(link.topicId)
    objects.set(key, topicIds)
  }
  return objects
}

function changedObjectKeys(previous: LabNotebookOrganization, next: LabNotebookOrganization) {
  const before = linksByObject(previous.topicLinks)
  const after = linksByObject(next.topicLinks)
  return new Set([...before.keys(), ...after.keys()].filter((key) => {
    const oldIds = before.get(key) ?? new Set<string>()
    const newIds = after.get(key) ?? new Set<string>()
    return oldIds.size !== newIds.size || [...oldIds].some((id) => !newIds.has(id))
  }))
}

export function hasLabOrganizationChanges(previous: LabNotebookOrganization, next: LabNotebookOrganization) {
  const oldIds = new Set(previous.topics.map((topic) => topic.id))
  return next.topics.some((topic) => !oldIds.has(topic.id)) || changedObjectKeys(previous, next).size > 0
}

/**
 * Rebase only this tab's additions and edited object memberships onto storage.
 * Unrelated changes from another tab survive; the same object's latest edit wins.
 */
export function mergeLabOrganizationChanges(
  previous: LabNotebookOrganization,
  next: LabNotebookOrganization,
  latest: LabNotebookOrganization,
): LabNotebookOrganization {
  const before = normalizeLabOrganization(previous)
  const desired = normalizeLabOrganization(next)
  const stored = normalizeLabOrganization(latest)
  if (!hasLabOrganizationChanges(before, desired)) return stored

  const changedObjects = changedObjectKeys(before, desired)
  const objectKey = (link: LabTopicLink) => JSON.stringify([link.objectType, link.objectId])
  return normalizeLabOrganization({
    // Stored names/IDs win a duplicate. Including desired topics also gives the
    // normalizer aliases for a same-name topic created concurrently in another tab.
    topics: [...stored.topics, ...desired.topics],
    topicLinks: [
      ...stored.topicLinks.filter((link) => !changedObjects.has(objectKey(link))),
      ...desired.topicLinks.filter((link) => changedObjects.has(objectKey(link))),
    ],
  })
}
