import { z } from 'zod';
export const panelMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('CAPTURE'), requestId: z.string().uuid() }),
  z.strictObject({ type: z.literal('VALIDATE_SNAPSHOT'), requestId: z.string().uuid(), snapshotId: z.string().uuid() }),
  z.strictObject({ type: z.literal('LOCATE_BLOCK'), requestId: z.string().uuid(), snapshotId: z.string().uuid(), blockId: z.string().regex(/^b\d{3,}$/), exactQuote: z.string().min(1).max(6000).optional() }),
  z.strictObject({ type: z.literal('SET_HIGHLIGHTS'), requestId: z.string().uuid(), snapshotId: z.string().uuid(), evidence: z.array(z.strictObject({ blockId: z.string().regex(/^b\d{3,}$/), exactQuote: z.string().min(1).max(6000) })).max(240) }),
  z.strictObject({ type: z.literal('CLEAR_HIGHLIGHTS'), requestId: z.string().uuid(), snapshotId: z.string().uuid() }),
  z.strictObject({ type: z.literal('RELEASE'), requestId: z.string().uuid() }),
]);
export type PanelMessage = z.infer<typeof panelMessageSchema>;
export type ContentReply<T> = { ok: true; requestId: string; data: T } | { ok: false; requestId: string; code: string; message: string };
export class CaptureError extends Error { constructor(public code: string, message: string) { super(message); } }
