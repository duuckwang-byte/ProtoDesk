/**
 * src/renderer/lib/legacy-migrate.ts — 旧版裸键的一次性迁移（只做迁移，不承载业务）。
 *
 * 背景（docs/data-wiring-map.md §5 / C12）：旧渲染器 `js/sandbox-core.js loadGroups`
 * 在“本项目作用域键不存在”时，会把裸全局键 `protoGroups_v1` 迁入当前项目并删除裸键。
 * React 侧原先明确“不迁移”，导致老用户首次进入 React 时分组为空。为保持
 * storage-keys.ts 的“原样读写、不迁移”契约，迁移逻辑单独收敛到本文件。
 *
 * 约束：
 * 1) 只在作用域键缺失、且裸键含非空 list 时迁移（与旧实现同口径）；
 * 2) 迁移后立即删除裸键，永不回写裸键；
 * 3) 迁移只归入“当前进入的项目”，其他项目不受影响；
 * 4) 任何异常都静默失败，绝不阻塞启动。
 */

import {
  GROUPS_KEY_BASE,
  groupsKey,
  readJson,
  removeKey,
  writeJson,
} from "./storage-keys"

interface LegacyGroupsPayload {
  list: unknown[]
  map?: Record<string, unknown>
}

function asLegacyGroups(value: unknown): LegacyGroupsPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  if (!Array.isArray(rec.list) || rec.list.length === 0) return null
  return {
    list: rec.list,
    map:
      rec.map && typeof rec.map === "object" && !Array.isArray(rec.map)
        ? (rec.map as Record<string, unknown>)
        : {},
  }
}

/**
 * 把裸键 `protoGroups_v1` 一次性迁入指定项目（旧 `loadGroups` 同口径）。
 *
 * @param project 当前进入的项目名（空串按旧规则落到 `_default` 作用域）
 * @returns 是否发生了迁移（true = 已写入作用域键并删除裸键）
 */
export function migrateLegacyGroups(project: string): boolean {
  try {
    // 已有本项目作用域数据（哪怕 list 为空）就不再迁移，避免覆盖新数据。
    const scoped = readJson(groupsKey(project), null)
    if (scoped && typeof scoped === "object" && Array.isArray((scoped as { list?: unknown }).list)) {
      return false
    }

    const legacy = asLegacyGroups(readJson(GROUPS_KEY_BASE, null))
    if (!legacy) return false

    writeJson(groupsKey(project), legacy)
    removeKey(GROUPS_KEY_BASE)
    return true
  } catch {
    return false
  }
}
