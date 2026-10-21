import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(32768),
}).strict();

const messagesSchema = z.array(messageSchema).min(1).max(50).superRefine((messages, context) => {
  const totalBytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
  if (totalBytes > 32768) {
    context.addIssue({ code: 'custom', message: 'Combined message content must not exceed 32 KB.' });
  }
  if (!messages.some((message) => message.role === 'user')) {
    context.addIssue({ code: 'custom', message: 'At least one user message is required.' });
  }
});

const optionsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.2),
  top_p: z.number().gt(0).max(1).default(0.9),
  num_ctx: z.number().int().min(256).max(32768).default(4096),
  num_predict: z.number().int().min(1).max(8192).optional(),
}).strict();

/** Runtime-validated public chat payload. Defaults keep clients simple. */
export const chatRequestSchema = z.object({
  messages: messagesSchema,
  mode: z.enum(['auto', 'force']).default('auto'),
  model: z.string().min(1).max(128).optional(),
  options: optionsSchema.default({ temperature: 0.2, top_p: 0.9, num_ctx: 4096 }),
  use_cache: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.mode === 'force' && !value.model) {
    context.addIssue({ code: 'custom', path: ['model'], message: 'model is required when mode is force.' });
  }
});

/** Preview accepts only fields that affect routing and does not call the inference backend. */
export const previewRequestSchema = z.object({
  messages: messagesSchema,
  mode: z.enum(['auto', 'force']).default('auto'),
  model: z.string().min(1).max(128).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === 'force' && !value.model) {
    context.addIssue({ code: 'custom', path: ['model'], message: 'model is required when mode is force.' });
  }
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
