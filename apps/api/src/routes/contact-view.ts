import { z } from 'zod';
import type { Request } from 'express';
import type { ContactFilter } from '@crm/core';
import { segmentDefinitionSchema } from './segments.js';

/**
 * What the Contacts screen sends to narrow the list: a search, one source (a file or a tag), and the grouped
 * filters. The list, its count, bulk tagging and the export all read it the same way, so the people on screen
 * are the people a bulk action or an export reaches.
 */
export const contactViewQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  /** Narrow to contacts carrying this tag. */
  tag: z.string().uuid().optional(),
  /** Narrow to the people one imported file brought in. */
  file: z.string().uuid().optional(),
  /** The grouped filters, as JSON in the same shape a saved list stores. Checked as strictly as a list is. */
  filter: z.string().max(4000).optional(),
  /** First and last day (`YYYY-MM-DD`, both included) of the date range, on `dateBy`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Which date `from` / `to` apply to: when the person was added, or when they were last imported. */
  dateBy: z.enum(['added', 'imported']).optional()
});

/** Why a view could not be read, in words for the 422. */
export class ViewError extends Error {}

/** Turns the parsed query into the filter the shared predicate reads. Throws `ViewError` on a bad `filter`. */
export function contactFilterFrom(v: z.infer<typeof contactViewQuery>): ContactFilter {
  let criteria: ContactFilter['criteria'];
  if (v.filter !== undefined && v.filter !== '') {
    let json: unknown;
    try { json = JSON.parse(v.filter); } catch { throw new ViewError('filter: not valid JSON'); }
    const parsed = segmentDefinitionSchema.safeParse(json);
    if (!parsed.success) {
      throw new ViewError(parsed.error.issues.map((i) => `filter.${i.path.join('.')}: ${i.message}`).join('; '));
    }
    criteria = parsed.data;
  }
  return {
    q: v.q, tagId: v.tag, from: v.from, to: v.to, dateBy: v.dateBy, importRunId: v.file, criteria
  };
}

/** Reads `req.query` into a filter, or returns the problem text. */
export function readView(req: Request): { filter: ContactFilter } | { error: string } {
  const parsed = contactViewQuery.safeParse(req.query);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  try {
    return { filter: contactFilterFrom(parsed.data) };
  } catch (error) {
    if (error instanceof ViewError) return { error: error.message };
    throw error;
  }
}
