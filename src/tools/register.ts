import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Context } from '../context.js';
export function tool<S extends z.ZodRawShape>(server: McpServer, ctx: Context, name: string,
  description: string, schema: S, readOnly: boolean, fn: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
  server.registerTool(name, {
    description, inputSchema: z.object(schema).strict(),
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false, idempotentHint: readOnly }
  }, async input => {
    try {
      const result = await ctx.exclusive(() => fn(input));
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > 900000) throw new Error('Response too large; narrow your query');
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      return { isError: true, content: [{ type: 'text' as const, text: e.code ? `Operation failed (${e.code})` : (e.message || 'Operation failed') }] };
    }
  });
}
