import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { tool } from './register.js';
export function registerEditing(server: McpServer, ctx: Context) {
  tool(server, ctx, 'preview_edit', 'Preview creation, replacement, or a single-file unified patch. Does not write. Requires current SHA-256 for existing files; returns a one-use token valid for 5 minutes. Apply only when the user requests code changes.', {
    path: z.string(), mode: z.enum(['create', 'replace', 'patch']), content: z.string().max(524288), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }, true, async input => ctx.editor.preview(input.path, input.mode, input.content, input.expectedHash));
  tool(server, ctx, 'apply_edit', 'Write exactly the previously reviewed preview. User must have requested this change. Fails if the file changed since preview. Token is single-use.', {
    token: z.string().regex(/^[a-f0-9]{48}$/)
  }, false, async ({ token }) => ctx.editor.apply(token));
}
