import { writable, derived } from 'svelte/store';
import { database } from '$lib/db/database';
import type { Document } from '$lib/db/schema';

function createDocumentsStore() {
  const { subscribe, set, update } = writable<Document[]>([]);

  return {
    subscribe,

    async load() {
      try {
        const result = await database.query<Document>(
          'SELECT * FROM documents ORDER BY created_at DESC'
        );
        set(result);
      } catch (error) {
        console.error('Failed to load documents:', error);
        set([]);
      }
    },

    async add(doc: Omit<Document, 'id' | 'created_at'>) {
      try {
        const result = await database.run(
          `INSERT INTO documents (name, type, file_path, file_size, mime_type, category, extracted_data, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [doc.name, doc.type, doc.file_path, doc.file_size, doc.mime_type, doc.category, doc.extracted_data, doc.notes]
        );

        const newDoc: Document = {
          id: result.lastId,
          ...doc,
          created_at: new Date().toISOString()
        };

        update(docs => [newDoc, ...docs]);
        return newDoc;
      } catch (error) {
        console.error('Failed to add document:', error);
        throw error;
      }
    },

    async update(id: number, updates: Partial<Omit<Document, 'id' | 'created_at'>>) {
      try {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        Object.entries(updates).forEach(([key, value]) => {
          setClauses.push(`${key} = ?`);
          values.push(value);
        });

        values.push(id);

        await database.run(
          `UPDATE documents SET ${setClauses.join(', ')} WHERE id = ?`,
          values
        );

        update(docs => docs.map(d => d.id === id ? { ...d, ...updates } : d));
      } catch (error) {
        console.error('Failed to update document:', error);
        throw error;
      }
    },

    async remove(id: number) {
      try {
        await database.run('DELETE FROM documents WHERE id = ?', [id]);
        update(docs => docs.filter(d => d.id !== id));
      } catch (error) {
        console.error('Failed to delete document:', error);
        throw error;
      }
    },

    async getByCategory(category: Document['category']) {
      try {
        const result = await database.query<Document>(
          'SELECT * FROM documents WHERE category = ? ORDER BY created_at DESC',
          [category]
        );
        return result;
      } catch (error) {
        console.error('Failed to get documents by category:', error);
        return [];
      }
    }
  };
}

export const documents = createDocumentsStore();

// Derived store for document count by category
export const documentCounts = derived(documents, ($documents) => {
  const counts: Record<string, number> = {
    manning_sheet: 0,
    toolbox_talk: 0,
    vacation_pay: 0,
    pay_stub: 0,
    timesheet: 0,
    other: 0
  };

  $documents.forEach(doc => {
    if (doc.category && counts[doc.category] !== undefined) {
      counts[doc.category]++;
    }
  });

  return counts;
});
