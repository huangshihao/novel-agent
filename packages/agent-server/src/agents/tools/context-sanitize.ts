import type { MapsRecord } from '../../storage/target-writer.js'

export function sanitizeMapsForAgent(maps: MapsRecord | null): MapsRecord | null {
  if (!maps) return null
  return {
    setting_map: maps.setting_map,
    character_map: maps.character_map.map((entry) => ({
      ...entry,
      source_meta: entry.source_meta
        ? { ...entry.source_meta, description: '' }
        : null,
    })),
  }
}
