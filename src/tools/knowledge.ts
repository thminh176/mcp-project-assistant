import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Context } from '../context.js';
import { tool } from './register.js';
import { hash } from '../editing.js';
import { gitDiff } from '../git.js';
import { ReadBudget, DeadlineError } from '../budget.js';
export function registerKnowledge(server: McpServer, ctx: Context) {
  tool(server, ctx, 'workspace_info', 'Return the selected workspace capabilities. Workspace selection is controlled by the operator at startup.', {}, true,
    async () => ({ id: ctx.workspace.id, writable: ctx.workspace.writable, verification: Object.keys(ctx.workspace.verification) }));
  tool(server, ctx, 'read_file', 'Read a UTF-8 source file with line numbers and SHA-256 for controlled editing.', {
    path: z.string(), startLine: z.number().int().min(1).default(1), maxLines: z.number().int().min(1).max(500).default(200)
  }, true, async input => {
    const content = await ctx.guard.read(input.path); const lines = content.split('\n');
    return { path: input.path, sha256: hash(content), totalLines: lines.length,
      lines: lines.slice(input.startLine - 1, input.startLine - 1 + input.maxLines).map((text, i) => ({ line: input.startLine + i, text })) };
  });
  tool(server, ctx, 'project_structure', 'List permitted project files (bounded traversal, excludes secret files and links). Use a small maxFiles for network/WSL roots.', {
    maxFiles: z.number().int().min(1).max(2000).default(500)
  }, true, async ({ maxFiles }) => ctx.guard.files(maxFiles));
  tool(server, ctx, 'search_code', 'Search literal text in permitted source files. No regex or shell execution.', {
    query: z.string().min(1).max(200), caseSensitive: z.boolean().default(false), maxResults: z.number().int().min(1).max(200).default(50)
  }, true, async input => {
    const budget = new ReadBudget();
    const listing = await ctx.guard.files(2000, budget); const matches: { path: string; line: number; text: string }[] = [];
    const query = input.caseSensitive ? input.query : input.query.toLowerCase();
    for (const file of listing.files) {
      budget.check();
      let content: string; try { content = await ctx.guard.read(file, budget); } catch (error) { if (error instanceof DeadlineError) throw error; continue; }
      for (const [index, line] of content.split('\n').entries()) {
        if ((input.caseSensitive ? line : line.toLowerCase()).includes(query)) matches.push({ path: file, line: index + 1, text: line.slice(0, 2000) });
        if (matches.length >= input.maxResults) return { matches, truncated: true };
      }
    }
    return { matches, truncated: listing.truncated };
  });
  tool(server, ctx, 'analyze_dependencies', 'Analyze declared direct dependencies in a Node package.json; does not install packages or access the network.', {
    manifest: z.string().default('package.json')
  }, true, async ({ manifest }) => {
    const data = JSON.parse(await ctx.guard.read(manifest)) as Record<string, unknown>;
    const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    return { manifest, ecosystem: 'node', groups: Object.fromEntries(groups.map(group => [group, data[group] ?? {}])),
      note: 'Declared direct versions only; no resolved transitive graph or vulnerability audit.' };
  });
  tool(server, ctx, 'git_diff', 'Get a diff for one permitted tracked file. External diff and textconv are disabled. Repository root must equal selected workspace.', {
    path: z.string(), staged: z.boolean().default(false)
  }, true, async input => {
    const file = ctx.guard.normalize(input.path); await ctx.guard.resolve(file, true);
    return gitDiff(ctx.workspace.root, file, input.staged);
  });
}
