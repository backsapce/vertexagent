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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all available skills with their metadata.
 * @returns {Promise<Array<{ name: string, description: string, version: string }>>}
 */
export async function listSkills() {
  debugger
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
 * Build the available skills section for the system prompt.
 * @returns {Promise<string>}
 */
export async function buildSkillsSection() {
  const skills = await listSkills();
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
