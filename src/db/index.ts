import Dexie, { type EntityTable } from 'dexie'

export interface Item {
  id: string
  name: string
  blob: Blob
  createdAt: number
  updatedAt: number
}

export interface Person {
  id: string
  name: string
  createdAt: number
}

export interface Selection {
  id: string
  personId: string
  itemId: string
  createdAt: number
}

class AppDB extends Dexie {
  items!: EntityTable<Item, 'id'>
  persons!: EntityTable<Person, 'id'>
  selections!: EntityTable<Selection, 'id'>

  constructor() {
    super('item-selector-db')
    this.version(1).stores({
      items: 'id, name, createdAt',
      persons: 'id, name, createdAt',
      selections: 'id, personId, itemId, [personId+itemId]',
    })
  }
}

export const db = new AppDB()

export function genId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function addItem(name: string, blob: Blob): Promise<Item> {
  const now = Date.now()
  const id = genId()
  await db.items.add({ id, name, blob, createdAt: now, updatedAt: now })
  return { id, name, blob, createdAt: now, updatedAt: now }
}

export async function updateItem(id: string, patch: Partial<Pick<Item, 'name' | 'blob'>>): Promise<void> {
  await db.items.update(id, { ...patch, updatedAt: Date.now() })
}

/** 删除图片，同时清理该图片所有选择关系 */
export async function deleteItem(id: string): Promise<number> {
  const selCount = await db.selections.where('itemId').equals(id).count()
  await db.transaction('rw', [db.items, db.selections], async () => {
    await db.selections.where('itemId').equals(id).delete()
    await db.items.delete(id)
  })
  return selCount
}

export async function addPerson(name: string): Promise<Person> {
  const now = Date.now()
  const id = genId()
  await db.persons.add({ id, name, createdAt: now })
  return { id, name, createdAt: now }
}

export async function renamePerson(id: string, name: string): Promise<void> {
  await db.persons.update(id, { name })
}

/** 删除人员 + 清理其所有选择关系 */
export async function deletePerson(id: string): Promise<number> {
  const selCount = await db.selections.where('personId').equals(id).count()
  await db.transaction('rw', [db.persons, db.selections], async () => {
    await db.selections.where('personId').equals(id).delete()
    await db.persons.delete(id)
  })
  return selCount
}

/** 确保存在 personId↔itemId 选择关系；返回是否新增 */
export async function selectItem(personId: string, itemId: string): Promise<boolean> {
  const existing = await db.selections.where('[personId+itemId]').equals([personId, itemId]).first()
  if (existing) return false
  await db.selections.add({ id: genId(), personId, itemId, createdAt: Date.now() })
  return true
}

export async function unselectItem(personId: string, itemId: string): Promise<void> {
  await db.selections.where('[personId+itemId]').equals([personId, itemId]).delete()
}

export async function setPersonSelections(personId: string, itemIds: string[]): Promise<void> {
  await db.transaction('rw', db.selections, async () => {
    await db.selections.where('personId').equals(personId).delete()
    const now = Date.now()
    const rows = itemIds.map((id) => ({
      id: genId(),
      personId,
      itemId: id,
      createdAt: now,
    }))
    if (rows.length) await db.selections.bulkAdd(rows)
  })
}

/** 清空一批选择关系（用于导出后清理）；返回被清掉的数量 */
export async function clearSelectionsByItemIds(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0
  const rows = await db.selections.where('itemId').anyOf(itemIds).toArray()
  await db.selections.where('itemId').anyOf(itemIds).delete()
  return rows.length
}

/** 撤销清空：用快照恢复 */
export async function restoreSelections(rows: Selection[]): Promise<void> {
  if (rows.length === 0) return
  const dedup = rows.filter((r, i, all) =>
    all.findIndex((x) => x.personId === r.personId && x.itemId === r.itemId) === i,
  )
  await db.selections.bulkAdd(dedup)
}

// 暴露到 globalThis 方便 browser_evaluate 直接写数据（测试用）
if (typeof globalThis !== 'undefined') (globalThis as any).__db = db
if (typeof globalThis !== 'undefined') (globalThis as any).__genId = genId

/** 读取某人员已选图片 id 列表 */
export async function getSelectedItemIdsOf(personId: string): Promise<string[]> {
  const rows = await db.selections.where('personId').equals(personId).toArray()
  return rows.map((r) => r.itemId)
}
