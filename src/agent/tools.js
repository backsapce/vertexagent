/**
 * Tool Registry — central hub for all agent tools.
 *
 * Inspired by Hermes Agent's ToolRegistry pattern.
 * Each tool has a name, JSON schema (OpenAI function-calling format), and an async handler.
 *
 * Usage:
 *   import { registry } from './agent/tools';
 *   registry.register({ name: 'my_tool', schema, handler });
 *   const result = await registry.dispatch('my_tool', { arg: 'value' }, agentContext);
 */

import { clearMemory, loadMemory, MEMORY_MAX, saveMemory, saveUser, USER_MAX } from './memory.js';
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from './skills.js';
import { executeCommand, listFiles, readFileText, writeFile } from '../models/agent';
import { listAgentFiles, loadFiles, readAgentFile, readFileContent, writeAgentFile } from '../vfs/opfs';
import config from '../config/config';

// ─── Registry singleton ─────────────────────────────────────────────────────

const _tools = new Map();

export const registry = {
  /** Register a tool. */
  register(tool) {
    _tools.set(tool.name, tool);
  },

  /** Get a tool by name. */
  get(name) {
    return _tools.get(name) || null;
  },

  /** Get all registered tools as an array. */
  getAll() {
    return Array.from(_tools.values());
  },

  /** Get tool schemas for LLM request (OpenAI function-calling format). */
  getSchemas() {
    return Array.from(_tools.values()).map((t) => ({
      name: t.name,
      description: t.schema.description,
      parameters: t.schema.parameters,
    }));
  },

  /** Dispatch a tool call by name with arguments. */
  async dispatch(name, args, context) {
    const tool = _tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    if (!isToolEnabled(name)) {
      throw new Error(`Tool disabled: ${name}`);
    }
    if (tool.checkAvailable && !tool.checkAvailable(context)) {
      throw new Error(`Tool not available: ${name}`);
    }
    return tool.handler(args, context);
  },

  /** Check if any tools are registered. */
  hasTools() {
    return _tools.size > 0;
  },
};

// ─── Tool enablement ───────────────────────────────────────────────────────

export function getDisabledTools() {
  const disabled = config.get('tools.disabled') || [];
  return new Set(disabled);
}

export async function setToolEnabled(name, enabled) {
  const disabledSet = getDisabledTools();
  if (enabled) {
    disabledSet.delete(name);
  } else {
    disabledSet.add(name);
  }
  await config.set('tools.disabled', Array.from(disabledSet));
}

export function isToolEnabled(name) {
  return !getDisabledTools().has(name);
}

export function listAllTools() {
  const disabledSet = getDisabledTools();
  return registry.getAll().map((tool) => ({
    name: tool.name,
    description: tool.schema.description,
    enabled: !disabledSet.has(tool.name),
  }));
}

export function getEnabledToolSchemas(context = {}) {
  const disabledSet = getDisabledTools();
  return registry
    .getAll()
    .filter((tool) => !disabledSet.has(tool.name))
    .filter((tool) => !tool.checkAvailable || tool.checkAvailable(context))
    .map((tool) => ({
      name: tool.name,
      description: tool.schema.description,
      parameters: tool.schema.parameters,
    }));
}

// ─── Built-in tools ─────────────────────────────────────────────────────────

registry.register({
  name: 'execute_command',
  schema: {
    description:
      'Execute a shell command on the selected sandbox host. Commands run in that host OS shell, so use syntax appropriate for the returned platform/shell.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  checkAvailable: (ctx) => !!ctx?.agentUrl,
  async handler({ command }, ctx) {
    const result = await executeCommand(command, ctx.agentUrl);
    let out = `Exit code: ${result.code}`;
    if (result.platform || result.shell || result.cwd) {
      out += `\nEnvironment: platform=${result.platform || 'unknown'}, shell=${result.shell || 'unknown'}, cwd=${result.cwd || 'unknown'}`;
    }
    if (result.stdout) out += `\nStdout:\n${result.stdout}`;
    if (result.stderr) out += `\nStderr:\n${result.stderr}`;
    return out;
  },
});

registry.register({
  name: 'read_file',
  schema: {
    description:
      'Read the contents of a file. Use this to examine files, check configuration, or inspect source code.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  checkAvailable: (ctx) => !!ctx?.agentUrl || !!ctx?.agentId,
  async handler({ path }, ctx) {
    try {
      if (ctx?.agentId && !ctx?.agentUrl) {
        // Local browser mode: read from agent workspace
        const content = await readAgentFile(ctx.agentId, path);
        return content ?? `File not found: ${path}`;
      }
      // Remote sandbox mode
      const content = await readFileText(path, ctx.agentUrl);
      return content;
    } catch (err) {
      return `Error reading file ${path}: ${err.message}`;
    }
  },
});

registry.register({
  name: 'write_file',
  schema: {
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  checkAvailable: (ctx) => !!ctx?.agentUrl || !!ctx?.agentId,
  async handler({ path, content }, ctx) {
    try {
      if (ctx?.agentId && !ctx?.agentUrl) {
        // Local browser mode: write to agent workspace
        await writeAgentFile(ctx.agentId, path, content);
        return `Successfully wrote to ${path}`;
      }
      // Remote sandbox mode
      await writeFile(path, content, ctx.agentUrl);
      return `Successfully wrote to ${path}`;
    } catch (err) {
      return `Error writing file ${path}: ${err.message}`;
    }
  },
});

registry.register({
  name: 'list_files',
  schema: {
    description:
      'List files and directories at a given path. Use this to explore directory contents.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (empty for root)',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  checkAvailable: (ctx) => !!ctx?.agentUrl || !!ctx?.agentId,
  async handler({ path = '' }, ctx) {
    try {
      if (ctx?.agentId && !ctx?.agentUrl) {
        // Local browser mode: list from agent workspace
        const result = await listAgentFiles(ctx.agentId, path);
        return formatFileTree(result, 0);
      }
      // Remote sandbox mode
      const result = await listFiles(path, ctx.agentUrl);
      return formatFileTree(result, 0);
    } catch (err) {
      return `Error listing files: ${err.message}`;
    }
  },
});

registry.register({
  name: 'list_local_files',
  schema: {
    description:
      'List files and directories stored in the browser (OPFS). Use this to see locally saved files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Subdirectory path to list (empty for root)',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async handler({ path = '' }, ctx) {
    try {
      if (ctx?.agentId) {
        // Agent workspace: list from agent's files dir
        const result = await listAgentFiles(ctx.agentId, path);
        return formatFileTree(result, 0);
      }
      // Fall back to global files dir
      const result = await loadFiles(path || undefined);
      return formatFileTree(result.children || result, 0);
    } catch (err) {
      return `Error listing local files: ${err.message}`;
    }
  },
});

registry.register({
  name: 'read_local_file',
  schema: {
    description:
      'Read the contents of a file stored in the browser (OPFS). Use this to examine locally saved files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file (relative to OPFS root)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async handler({ path }, ctx) {
    try {
      if (ctx?.agentId) {
        // Agent workspace: read from agent's files dir
        const content = await readAgentFile(ctx.agentId, path);
        return content ?? `File not found: ${path}`;
      }
      // Fall back to global files dir
      const parts = path.split('/');
      const fileName = parts.pop();
      const dirName = parts.length > 0 ? parts.join('/') : undefined;
      const content = await readFileContent(fileName, dirName);
      return content;
    } catch (err) {
      return `Error reading local file ${path}: ${err.message}`;
    }
  },
});

// Memory tools — these are intercepted before dispatch since they need memory state
registry.register({
  name: 'write_memory',
  schema: {
    description:
      'Write a note to your memory. Use this to record important information about the environment, project conventions, tool quirks, or user preferences that should be remembered across sessions.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The memory entry to save. Keep it concise and informative.',
        },
        type: {
          type: 'string',
          enum: ['memory', 'user'],
          description:
            'Type of memory: "memory" for project/environment notes, "user" for user profile and preferences',
        },
      },
      required: ['content', 'type'],
      additionalProperties: false,
    },
  },
  async handler({ content, type }, ctx) {
    try {
      const agentId = ctx?.agentId;
      if (type === 'user') {
        await saveUser(content, agentId);
        return `Saved to USER.md (${content.length}/${USER_MAX} chars)`;
      }
      await saveMemory(content, agentId);
      return `Saved to MEMORY.md (${content.length}/${MEMORY_MAX} chars)`;
    } catch (err) {
      return `Error saving memory: ${err.message}`;
    }
  },
});

registry.register({
  name: 'read_memory',
  schema: {
    description:
      'Read your current memory notes and user profile. Use this to recall previously saved information.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['memory', 'user', 'both'],
          description: 'Which memory to read: "memory", "user", or "both"',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async handler({ type = 'both' }, ctx) {
    const data = await loadMemory(ctx?.agentId);
    if (type === 'memory') return data.memory || 'MEMORY.md is empty.';
    if (type === 'user') return data.user || 'USER.md is empty.';
    let out = '';
    if (data.memory) out += `=== MEMORY.md ===\n${data.memory}\n\n`;
    if (data.user) out += `=== USER.md ===\n${data.user}\n`;
    return out || 'Both memory files are empty.';
  },
});

registry.register({
  name: 'clear_memory',
  schema: {
    description:
      'Clear all memory notes. Use this with caution — this cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['memory', 'user', 'both'],
          description: 'Which memory to clear',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async handler({ type = 'both' }, ctx) {
    await clearMemory(type, ctx?.agentId);
    return `Cleared ${type === 'both' ? 'all memory' : type === 'memory' ? 'MEMORY.md' : 'USER.md'}.`;
  },
});

// Skill tools — intercepted before dispatch
registry.register({
  name: 'skills_list',
  schema: {
    description: 'List all available skills with their names and descriptions. Skills provide specialized knowledge and procedures for specific tasks.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  async handler(_args, ctx) {
    const skills = await listSkills(ctx?.agentId);
    if (skills.length === 0)
      return 'No skills installed. Use the skill_manage tool to create one.';
    return skills
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join('\n');
  },
});

registry.register({
  name: 'skill_view',
  schema: {
    description:
      'Load the full instructions for a skill. Use this when you need detailed procedures for a specific task.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The skill name (exact match)',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  async handler({ name }, ctx) {
    const skill = await getSkill(name, ctx?.agentId);
    if (!skill) return `Skill "${name}" not found.`;
    return skill.content;
  },
});

registry.register({
  name: 'skill_manage',
  schema: {
    description:
      'Create, update, or delete skills. Use this to manage your skill library.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'Action to perform',
        },
        name: {
          type: 'string',
          description: 'Skill name (identifier, no spaces)',
        },
        content: {
          type: 'string',
          description:
            'SKILL.md content (required for create/update). Include YAML frontmatter with name, description, version.',
        },
      },
      required: ['action', 'name'],
      additionalProperties: false,
    },
  },
  async handler({ action, name, content }, ctx) {
    try {
      const agentId = ctx?.agentId;
      if (action === 'create') {
        if (!content) return 'Error: content is required for create.';
        await createSkill(name, content, agentId);
        return `Skill "${name}" created.`;
      }
      if (action === 'update') {
        if (!content) return 'Error: content is required for update.';
        await updateSkill(name, content, agentId);
        return `Skill "${name}" updated.`;
      }
      if (action === 'delete') {
        await deleteSkill(name, agentId);
        return `Skill "${name}" deleted.`;
      }
      return `Unknown action: ${action}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a file tree result as a readable string. */
function formatFileTree(node, depth = 0) {
  if (Array.isArray(node)) {
    return node.map((f) => `${'  '.repeat(depth)}${f.type === 'directory' ? '📁' : '📄'} ${f.name}`).join('\n');
  }
  if (!node || !node.children) return '(empty)';
  const indent = '  '.repeat(depth);
  return node.children
    .map((child) => {
      const icon = child.type === 'directory' ? '📁' : '📄';
      let line = `${indent}${icon} ${child.name}`;
      if (child.children?.length) {
        line += '\n' + formatFileTree(child, depth + 1);
      }
      return line;
    })
    .join('\n');
}
