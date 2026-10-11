import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { tool } from './register.js';
import { run } from '../process.js';
export function registerVerification(server: McpServer, ctx: Context) {
  tool(server, ctx, 'run_verification', 'Run exactly an operator-configured lint/typecheck/test/build command; cannot accept shell, arguments, executable or cwd from clients. Trusted project code may run and generate files.', {
    task: z.enum(['lint', 'typecheck', 'test', 'build'])
  }, false, async ({ task }) => {
    const command = ctx.workspace.verification[task];
    if (!command) throw new Error('Verification task is not allowlisted');
    return run(command.executable, command.args, ctx.workspace.root, command.timeoutMs);
  });
}
