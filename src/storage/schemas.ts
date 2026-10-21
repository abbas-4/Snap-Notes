import { z } from 'zod';
import { ID_PATTERN } from '../domain/ids';
import { SCHEMA_VERSION, type AppData, type Card, type Deck } from '../domain/types';

const idSchema = z.string().regex(ID_PATTERN, 'must be 1–64 letters, digits, "-" or "_"');
const timestampSchema = z.number().int().positive();

export const deckSchema = z
  .object({
    id: idSchema,
    name: z.string().refine((name) => name.trim() !== '', 'deck name cannot be empty'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine((deck) => deck.updatedAt >= deck.createdAt, {
    message: 'updatedAt cannot be earlier than createdAt',
    path: ['updatedAt'],
  }) satisfies z.ZodType<Deck>;

export const cardSchema = z
  .object({
    id: idSchema,
    deckId: idSchema,
    term: z.string(),
    definition: z.string(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  // A card may have one empty side (legacy imports allowed this), but not both.
  .refine((card) => card.term.trim() !== '' || card.definition.trim() !== '', {
    message: 'card needs a term or a definition',
  })
  .refine((card) => card.updatedAt >= card.createdAt, {
    message: 'updatedAt cannot be earlier than createdAt',
    path: ['updatedAt'],
  }) satisfies z.ZodType<Card>;

export const appDataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    decks: z.array(deckSchema),
    cards: z.array(cardSchema),
  })
  .superRefine((data, ctx) => {
    const deckIds = new Set<string>();
    data.decks.forEach((deck, index) => {
      if (deckIds.has(deck.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate deck id "${deck.id}"`,
          path: ['decks', index, 'id'],
        });
      }
      deckIds.add(deck.id);
    });

    const cardIds = new Set<string>();
    data.cards.forEach((card, index) => {
      if (cardIds.has(card.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate card id "${card.id}"`,
          path: ['cards', index, 'id'],
        });
      }
      cardIds.add(card.id);
      if (!deckIds.has(card.deckId)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown deck "${card.deckId}"`,
          path: ['cards', index, 'deckId'],
        });
      }
    });
  }) satisfies z.ZodType<AppData>;

/** Turns a validation error into a short, readable message such as `cards.2.term: expected string`. */
export function describeIssues(error: z.ZodError, limit = 3): string {
  const lines = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const hidden = error.issues.length - lines.length;
  return hidden > 0 ? `${lines.join('; ')} (and ${hidden} more)` : lines.join('; ');
}
