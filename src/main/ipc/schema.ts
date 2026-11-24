import { z } from 'zod'

export const pathSchema = z.string().min(1).max(32767)
export const deckIdSchema = z.string().regex(/^[0-9a-f]{12}$/)
export const pageIndexSchema = z.number().int().min(0).max(100000)

export const pageSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive()
})

export const reportMetricsSchema = z.object({
  deckId: deckIdSchema,
  pageCount: z.number().int().min(0).max(100000),
  pageSizes: z.array(pageSizeSchema).max(100000)
})

export const settingsPatchSchema = z
  .object({
    preferCom: z.boolean().optional(),
    loPathOverride: z.string().max(32767).optional(),
    cacheBudgetMb: z.number().int().min(128).max(8192).optional(),
    loopPlayback: z.boolean().optional(),
    recentFiles: z.array(z.string().max(32767)).max(20).optional()
  })
  .strict()

export const playEnterSchema = z.object({
  deckId: deckIdSchema,
  pageIndex: pageIndexSchema
})

export const strokeSchema = z.object({
  tool: z.enum(['pen', 'highlighter', 'eraser']),
  color: z.string().max(32),
  width: z.number().positive().max(200),
  points: z.array(z.number()).max(200000)
})

export const inkPagesSchema = z.object({
  deckId: deckIdSchema,
  pages: z
    .array(
      z.object({
        pageIndex: pageIndexSchema,
        strokes: z.array(strokeSchema).max(5000)
      })
    )
    .max(100000)
})

export const setLoPathSchema = z.object({ path: z.string().max(32767) })
