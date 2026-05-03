/**
 * Skill System — file-based skills in OPFS with progressive disclosure.
 *
 * Inspired by Hermes Agent's SKILL.md pattern.
 * Each skill is a directory under OPFS `skills/` containing a SKILL.md file
 * with YAML frontmatter and optional reference files.
 *
 * Three-tier progressive disclosure:
 *   Tier 1: skills_list tool returns only name + description (in system prompt)
 *   Tier 2: skill_view loads the full SKILL.md content on demand
 *   Tier 3: skill_view can also load reference files within a skill's directory
 *
 * Usage:
 *   import { listSkills, getSkill, createSkill } from './agent/skills';
 *   const skills = await listSkills();
 *   const skill = await getSkill('research');
 *   await createSkill('research', '---\nname: research\n...\n');
 */

import {
  listSkillDirs,
  readSkillFile,
  writeSkillFile,
  deleteSkillDir,
  listSkillRefs,
  readSkillRef,
} from '../vfs/opfs';
import config from '../config/config';

// ─── Default Skills ───────────────────────────────────────────────────────────

const DEFAULT_SKILLS = [
  {
    name: 'skill-creator',
    content: `---
name: skill-creator
description: Guide for creating new skills. Use this when the user wants to add a new skill or asks how to create one.
version: 1.0.0
---

# Skill Creator

This skill guides you through creating a new skill for this agent system.

## What is a Skill

A skill is a directory under the OPFS \`skills/\` folder containing a \`SKILL.md\` file with YAML frontmatter. Skills provide) are progressively disclosed to the LLM — only name and description appear in the system prompt until the LLM requests the full content.

## Skill Structure

Each skill lives in its own directory:

\`\`\`
skills/
  my-skill/
    SKILL.md          # Required — frontmatter + instructions
    references/       # Optional — supplementary files
      example.md
      template.txt
\`\`\`

## SKILL.md Format

\`\`\`markdown
---
name: my-skill
description: A brief description of what this skill does and when to use it.
version: 1.0.0
---

# My Skill

Detailed instructions for the LLM on how to use this skill.
Be specific about:
- When to activate this skill
- What steps to follow
- What output format to produce
- Any constraints or edge cases
\`\`\`

### Frontmatter fields

- **name** (required): Unique identifier, lowercase, hyphens, no spaces.
- **description** (required): Short summary shown in the system prompt. Write it so the LLM knows *when* to load this skill.
- **version** (required): Semantic version string.

## Creating a Skill

When the user wants to create a skill, follow these steps:

1. **Determine the skill name** — lowercase, hyphens allowed, e.g. \`code-reviewer\`, \`data-analyst\`.
2. **Write the frontmatter** — name, description, version.
3. **Write the SKILL.md body** — clear instructions for the LLM, including triggers, steps, and output format.
4. **Optionally add reference files** — place them in \`references/\` within the skill directory.
5. **Call the \`create_skill\` tool** with the name and full content.

## Reference Files

Use the \`references/\` subdirectory for:
- Templates the LLM should fill in
- Detailed API docs or schema definitions
- Large configuration examples
- Any content too verbose to include in SKILL.md itself

Reference files are only loaded when the LLM explicitly views the skill. Keep SKILL.md concise.

## Best Practices

- **Be specific in the description** — this is the only thing the LLM sees before deciding whether to load the skill. Include trigger phrases like "when the user asks about X" or "for Y workflows".
- **Write SKILL.md as instructions to the LLM**, not as user-facing documentation.
- **Keep SKILL.md under ~200 lines** — move details to reference files.
- **Test the skill** by creating it and verifying it appears in the system prompt.
`,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure all default skills exist in OPFS, creating any that are missing.
 * Safe to call multiple times — only creates missing skills.
 */
export async function ensureDefaultSkills() {
  const existing = await listSkillDirs();
  const existingNames = new Set(existing.map((d) => d.name));
  for (const def of DEFAULT_SKILLS) {
    if (!existingNames.has(def.name)) {
      await writeSkillFile(def.name, 'SKILL.md', def.content);
    }
  }
}

/**
 * List all available skills with their metadata.
 * @returns {Promise<Array<{ name: string, description: string, version: string }>>}
 */
export async function listSkills() {
  await ensureDefaultSkills();
  const dirs = await listSkillDirs();
  const skills = [];
  for (const dir of dirs) {
    const content = await readSkillFile(dir.name, 'SKILL.md');
    if (!content) continue;
    const { name, description, version } = parseFrontmatter(content);
    skills.push({
      name: name || dir.name,
      description: description || 'No description provided',
      version: version || '1.0.0',
    });
  }
  return skills;
}

/**
 * Load the full skill content including references if available.
 * @param {string} name - Skill name (exact match)
 * @returns {Promise<{ name: string, content: string, refs?: Array<{name, content}> }|null>}
 */
export async function getSkill(name) {
  const content = await readSkillFile(name, 'SKILL.md');
  if (!content) return null;

  const refs = await listSkillRefs(name);
  const refContents = [];
  for (const ref of refs) {
    const refContent = await readSkillRef(name, ref.name);
    if (refContent) refContents.push({ name: ref.name, content: refContent });
  }

  let fullContent = content;
  if (refContents.length > 0) {
    fullContent += '\n\n=== Reference Files ===\n';
    for (const ref of refContents) {
      fullContent += `\n--- ${ref.name} ---\n${ref.content}\n`;
    }
  }

  return { name, content: fullContent };
}

/**
 * Create a new skill.
 * @param {string} name - Skill identifier (no spaces)
 * @param {string} content - Full SKILL.md content with YAML frontmatter
 */
export async function createSkill(name, content) {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  await writeSkillFile(sanitized, 'SKILL.md', content);
}

/**
 * Update an existing skill's content.
 * @param {string} name
 * @param {string} content
 */
export async function updateSkill(name, content) {
  await writeSkillFile(name, 'SKILL.md', content);
}

/**
 * Delete a skill.
 * @param {string} name
 */
export async function deleteSkill(name) {
  await deleteSkillDir(name);
}

/**
 * Get the set of disabled skill names.
 * @returns {Promise<Set<string>>}
 */
export async function getDisabledSkills() {
  const disabled = config.get('skills.disabled') || [];
  return new Set(disabled);
}

/**
 * Toggle a skill's enabled/disabled state.
 * @param {string} name - Skill name
 * @param {boolean} enabled - true to enable, false to disable
 */
export async function setSkillEnabled(name, enabled) {
  const disabled = config.get('skills.disabled') || [];
  const disabledSet = new Set(disabled);
  if (enabled) {
    disabledSet.delete(name);
  } else {
    disabledSet.add(name);
  }
  await config.set('skills.disabled', Array.from(disabledSet));
}

/**
 * Check if a skill is enabled.
 * @param {string} name - Skill name
 * @returns {Promise<boolean>}
 */
export async function isSkillEnabled(name) {
  const disabled = config.get('skills.disabled') || [];
  return !disabled.includes(name);
}

/**
 * List all available skills with their metadata and enabled state.
 * @param {boolean} [includeDisabled=true] - Whether to include disabled skills
 * @returns {Promise<Array<{ name: string, description: string, version: string, enabled: boolean }>>}
 */
export async function listAllSkills(includeDisabled = true) {
  await ensureDefaultSkills();
  const dirs = await listSkillDirs();
  const skills = [];
  const disabledSet = includeDisabled ? await getDisabledSkills() : new Set();
  
  for (const dir of dirs) {
    const content = await readSkillFile(dir.name, 'SKILL.md');
    if (!content) continue;
    const { name, description, version } = parseFrontmatter(content);
    const skillName = name || dir.name;
    skills.push({
      name: skillName,
      description: description || 'No description provided',
      version: version || '1.0.0',
      enabled: !disabledSet.has(skillName),
    });
  }
  return skills;
}

/**
 * Build the available skills section for the system prompt.
 * Only includes enabled skills.
 * @returns {Promise<string>}
 */
export async function buildSkillsSection() {
  await ensureDefaultSkills();
  const disabledSet = await getDisabledSkills();
  const dirs = await listSkillDirs();
  const skills = [];
  
  for (const dir of dirs) {
    const content = await readSkillFile(dir.name, 'SKILL.md');
    if (!content) continue;
    const { name, description } = parseFrontmatter(content);
    const skillName = name || dir.name;
    if (disabledSet.has(skillName)) continue;
    skills.push({ name: skillName, description: description || 'No description provided' });
  }
  
  if (skills.length === 0) return '';
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return `<available_skills>\n${list}\n</available_skills>\n\n`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Supports a minimal parser for the common fields: name, description, version.
 */
function parseFrontmatter(content) {
  const result = { name: null, description: null, version: null };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return result;

  const frontmatter = match[1];
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) {
      result.name = trimmed.slice(5).trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('description:')) {
      result.description = trimmed.slice(12).trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('version:')) {
      result.version = trimmed.slice(8).trim().replace(/^["']|["']$/g, '');
    }
  }
  return result;
}
