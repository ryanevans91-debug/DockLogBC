import { writable, derived } from 'svelte/store';
import { database } from '$lib/db/database';
import type { ShareGroup } from '$lib/db/schema';

function createShareGroupsStore() {
  const { subscribe, set, update } = writable<ShareGroup[]>([]);

  return {
    subscribe,

    async load() {
      try {
        const result = await database.query<ShareGroup>(
          'SELECT * FROM share_groups ORDER BY created_at DESC'
        );
        set(result);
      } catch (error) {
        console.error('Failed to load share groups:', error);
        set([]);
      }
    },

    async add(group: Omit<ShareGroup, 'id' | 'created_at'>) {
      try {
        const result = await database.run(
          `INSERT INTO share_groups (name, platform, identifier)
           VALUES (?, ?, ?)`,
          [group.name, group.platform, group.identifier]
        );

        const newGroup: ShareGroup = {
          id: result.lastId,
          ...group,
          created_at: new Date().toISOString()
        };

        update(groups => [newGroup, ...groups]);
        return newGroup;
      } catch (error) {
        console.error('Failed to add share group:', error);
        throw error;
      }
    },

    async update(id: number, updates: Partial<Omit<ShareGroup, 'id' | 'created_at'>>) {
      try {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        Object.entries(updates).forEach(([key, value]) => {
          setClauses.push(`${key} = ?`);
          values.push(value);
        });

        values.push(id);

        await database.run(
          `UPDATE share_groups SET ${setClauses.join(', ')} WHERE id = ?`,
          values
        );

        update(groups => groups.map(g => g.id === id ? { ...g, ...updates } : g));
      } catch (error) {
        console.error('Failed to update share group:', error);
        throw error;
      }
    },

    async remove(id: number) {
      try {
        await database.run('DELETE FROM share_groups WHERE id = ?', [id]);
        update(groups => groups.filter(g => g.id !== id));
      } catch (error) {
        console.error('Failed to delete share group:', error);
        throw error;
      }
    }
  };
}

export const shareGroups = createShareGroupsStore();

// Derived stores for groups by platform
export const whatsappGroups = derived(shareGroups, ($groups) =>
  $groups.filter(g => g.platform === 'whatsapp')
);

export const telegramGroups = derived(shareGroups, ($groups) =>
  $groups.filter(g => g.platform === 'telegram')
);
