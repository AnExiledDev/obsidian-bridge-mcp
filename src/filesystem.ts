import { join, resolve, relative, dirname } from 'path';
import { readdir, stat, readFile, writeFile, unlink, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, EditNoteParams, EditNoteResult } from './types.js';

export class FileSystemService {
  private frontmatterHandler: FrontmatterHandler;
  private pathFilter: PathFilter;

  /**
   * Creates a new FileSystemService instance for managing Obsidian vault operations.
   *
   * @param vaultPath - Absolute path to the Obsidian vault root directory
   * @param pathFilter - Optional PathFilter instance for controlling file access. Defaults to new PathFilter() if not provided.
   * @param frontmatterHandler - Optional FrontmatterHandler instance for parsing/serializing frontmatter. Defaults to new FrontmatterHandler() if not provided.
   */
  constructor(
    private vaultPath: string,
    pathFilter?: PathFilter,
    frontmatterHandler?: FrontmatterHandler
  ) {
    this.vaultPath = resolve(vaultPath);
    this.pathFilter = pathFilter || new PathFilter();
    this.frontmatterHandler = frontmatterHandler || new FrontmatterHandler();
  }

  private resolvePath(relativePath: string): string {
    if (!relativePath) {
      relativePath = '';
    }

    relativePath = relativePath.trim();

    const normalizedPath = relativePath.startsWith('/')
      ? relativePath.slice(1)
      : relativePath;

    const fullPath = resolve(join(this.vaultPath, normalizedPath));

    // Security check: ensure path is within vault
    const relativeToVault = relative(this.vaultPath, fullPath);
    if (relativeToVault.startsWith('..')) {
      throw new Error(`Path traversal not allowed: ${relativePath}`);
    }

    return fullPath;
  }

  /**
   * Reads a note from the vault and parses its frontmatter and content.
   *
   * @param path - Relative path to the note within the vault
   * @returns ParsedNote object containing frontmatter, content, and original content
   * @throws Error if file not found, access denied, path is a directory, or read fails
   */
  async readNote(path: string): Promise<ParsedNote> {
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}`);
    }

    const isDir = await this.isDirectory(path);
    if (isDir) {
      throw new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`);
    }

    try {
      try {
        await access(fullPath, constants.F_OK);
      } catch {
        throw new Error(`File not found: ${path}`);
      }

      const content = await readFile(fullPath, 'utf-8');
      return this.frontmatterHandler.parse(content);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('File not found')) {
          throw error;
        }
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}`);
        }
        if (error.message.includes('Cannot read directory')) {
          throw error;
        }
      }
      throw new Error(`Failed to read file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Writes a note to the vault with optional frontmatter.
   *
   * Supports three write modes:
   * - 'overwrite': Replaces entire file content (default)
   * - 'append': Adds content to end of existing note, merging frontmatter
   * - 'prepend': Adds content to beginning of existing note, merging frontmatter
   *
   * @param params - NoteWriteParams containing path, content, optional frontmatter, and mode
   * @throws Error if access denied, invalid frontmatter, permission denied, or disk full
   */
  async writeNote(params: NoteWriteParams): Promise<void> {
    const { path, content, frontmatter, mode = 'overwrite' } = params;
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}`);
    }

    if (frontmatter) {
      const validation = this.frontmatterHandler.validate(frontmatter);
      if (!validation.isValid) {
        throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
      }
    }

    try {
      let finalContent: string;

      if (mode === 'overwrite') {
        finalContent = frontmatter
          ? this.frontmatterHandler.stringify(frontmatter, content)
          : content;
      } else {
        let existingNote: ParsedNote;
        try {
          existingNote = await this.readNote(path);
        } catch (error) {
          // File doesn't exist, treat as overwrite
          finalContent = frontmatter
            ? this.frontmatterHandler.stringify(frontmatter, content)
            : content;
        }

        if (existingNote!) {
          const mergedFrontmatter = frontmatter
            ? { ...existingNote.frontmatter, ...frontmatter }
            : existingNote.frontmatter;

          if (mode === 'append') {
            finalContent = this.frontmatterHandler.stringify(
              mergedFrontmatter,
              existingNote.content + content
            );
          } else if (mode === 'prepend') {
            finalContent = this.frontmatterHandler.stringify(
              mergedFrontmatter,
              content + existingNote.content
            );
          }
        }
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, finalContent!, 'utf-8');
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}`);
        }
        if (error.message.includes('space') || error.message.includes('ENOSPC')) {
          throw new Error(`No space left on device: ${path}`);
        }
      }
      throw new Error(`Failed to write file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Efficiently updates part of a note by replacing a specific string.
   *
   * This is more efficient than rewriting the entire note for small changes.
   * Provides detailed error messages with solutions for common issues.
   *
   * @param params - PatchNoteParams containing path, oldString, newString, and optional replaceAll flag
   * @returns PatchNoteResult indicating success/failure with descriptive message and match count
   */
  async patchNote(params: PatchNoteParams): Promise<PatchNoteResult> {
    const { path, oldString, newString, replaceAll = false } = params;

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path,
        message: `Error: Access to path '${path}' is denied.\n\nSolution: Ensure the path is within the vault and doesn't match any ignored patterns.`
      };
    }

    if (!oldString || oldString.trim() === '') {
      return {
        success: false,
        path,
        message: `Error: oldString cannot be empty.\n\nSolution: Provide a non-empty string to search for in the note.`
      };
    }

    if (newString === '') {
      return {
        success: false,
        path,
        message: `Error: newString cannot be empty.\n\nSolution: Provide a non-empty replacement string. To delete text, use the delete_note tool instead.`
      };
    }

    if (oldString === newString) {
      return {
        success: false,
        path,
        message: `Error: oldString and newString must be different.\n\nSolution: Provide different values for oldString and newString to perform a replacement.`
      };
    }

    try {
      const note = await this.readNote(path);

      const fullContent = note.originalContent;

      const occurrences = fullContent.split(oldString).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          path,
          message: `Error: String not found in note: "${oldString.substring(0, 50)}${oldString.length > 50 ? '...' : ''}"\n\nSolution: Verify the exact text exists in the note, including capitalization and whitespace. Use read_note to check the current content.`,
          matchCount: 0
        };
      }

      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          path,
          message: `Error: Found ${occurrences} occurrences of the string.\n\nSolution: Use replaceAll=true to replace all occurrences, or provide a more specific string to match exactly one occurrence.`,
          matchCount: occurrences
        };
      }

      const updatedContent = replaceAll
        ? fullContent.split(oldString).join(newString)
        : fullContent.replace(oldString, newString);

      const fullPath = this.resolvePath(path);
      await writeFile(fullPath, updatedContent, 'utf-8');

      return {
        success: true,
        path,
        message: `Successfully replaced ${replaceAll ? occurrences : 1} occurrence${occurrences > 1 ? 's' : ''}`,
        matchCount: occurrences
      };

    } catch (error) {
      return {
        success: false,
        path,
        message: `Error: Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}\n\nSolution: Check that the file exists and you have permission to write to it. Use read_note to verify the file is accessible.`
      };
    }
  }

  /**
   * Performs atomic multi-edit operations on a note with conflict detection.
   *
   * Supports multiple edit types: string match, line-based, regex, and anchor-based.
   * All operations are atomic - either all succeed or none are applied.
   * Detects and prevents overlapping edits to ensure predictable results.
   *
   * @param params - EditNoteParams containing path, edits array (max 10), deletions array (max 10), and options
   * @returns EditNoteResult indicating success/failure with counts of applied operations
   */
  async editNote(params: EditNoteParams): Promise<EditNoteResult> {
    const { path, edits = [], deletions = [], options = {} } = params;

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        message: `Error: Access to path '${path}' is denied.\n\nSolution: Ensure the path is within the vault and doesn't match any ignored patterns.`
      };
    }

    if (edits.length > 10) {
      return {
        success: false,
        message: `Error: You provided ${edits.length} edits, but the maximum is 10 per call.\n\nSolution: Split your edits into multiple edit_note calls (note: each call is atomic, but multiple calls are not). Alternatively, prioritize the 10 most important changes for a single atomic operation.`
      };
    }

    if (deletions.length > 10) {
      return {
        success: false,
        message: `Error: You provided ${deletions.length} deletions, but the maximum is 10 per call.\n\nSolution: Split your deletions into multiple edit_note calls (note: each call is atomic, but multiple calls are not). Alternatively, prioritize the 10 most important deletions for a single atomic operation.`
      };
    }

    if (edits.length === 0 && deletions.length === 0) {
      return {
        success: false,
        message: `Error: No edits or deletions provided.\n\nSolution: Provide at least one edit in the 'edits' array or one deletion in the 'deletions' array.`
      };
    }

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit) continue;
      if ('replace' in edit && edit.replace === '') {
        return {
          success: false,
          message: `Error: You provided an empty string as a replacement in edit #${i}.\n\nSolution: To delete text, use the 'deletions' array instead of 'edits'. For example: {deletions: [{match: 'text to delete'}]}`
        };
      }
    }

    try {
      const note = await this.readNote(path);

      const editFrontmatter = options.editFrontmatter || false;
      const preserveIndentation = options.preserveIndentation || false;
      let originalContent: string;

      if (editFrontmatter) {
        if (!note.frontmatter || Object.keys(note.frontmatter).length === 0) {
          originalContent = '';
        } else {
          // Extract just the frontmatter YAML (without the --- delimiters)
          const fullContent = note.originalContent;
          const frontmatterMatch = fullContent.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch && frontmatterMatch[1]) {
            originalContent = frontmatterMatch[1];
          } else {
            originalContent = '';
          }
        }
      } else {
        originalContent = note.content;
      }

      interface OperationPosition {
        type: 'edit' | 'deletion';
        index: number;
        start: number;
        end: number;
        matchText: string;
        computedReplace?: string;  // For regex edits with capture groups
      }

      const operationPositions: OperationPosition[] = [];
      let editsApplied = 0;
      let deletionsApplied = 0;

      const getLineInfo = (lineNumber: number): { content: string; start: number; end: number } | null => {
        const lines = originalContent.split('\n');
        if (lineNumber < 1 || lineNumber > lines.length) {
          return null;
        }
        const lineContent = lines[lineNumber - 1];
        if (lineContent === undefined) {
          return null;
        }
        let start = 0;
        for (let i = 0; i < lineNumber - 1; i++) {
          const line = lines[i];
          if (line === undefined) {
            return null;
          }
          start += line.length + 1; // +1 for newline
        }
        return {
          content: lineContent,
          start,
          end: start + lineContent.length
        };
      };

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (!edit) continue;

        if ('line' in edit) {
          const lineInfo = getLineInfo(edit.line);
          if (!lineInfo) {
            return {
              success: false,
              message: `Error: Edit #${i} references line ${edit.line}, but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${originalContent.split('\n').length} lines.\n\nSolution: Use a valid line number between 1 and ${originalContent.split('\n').length}, or use read_note to check the current content.`
            };
          }

          // Treat as a match operation for the entire line
          operationPositions.push({
            type: 'edit',
            index: i,
            start: lineInfo.start,
            end: lineInfo.end,
            matchText: lineInfo.content
          });
        } else if ('match' in edit) {
          const { match, occurrence } = edit;

          const positions: number[] = [];
          let searchIndex = 0;
          let index = -1;

          while ((index = originalContent.indexOf(match, searchIndex)) !== -1) {
            positions.push(index);
            searchIndex = index + match.length;
          }

          if (positions.length === 0) {
            return {
              success: false,
              message: `Error: Could not find the text '${match.substring(0, 50)}${match.length > 50 ? '...' : ''}' anywhere in the ${editFrontmatter ? 'frontmatter' : 'note'}.\n\nSolution: Double-check the exact text you're trying to match, including capitalization and whitespace. Use the read_note tool to verify the current content.`
            };
          }

          // Handle occurrence parameter
          if (positions.length > 1 && !occurrence) {
            return {
              success: false,
              message: `Error: Found ${positions.length} occurrences of '${match.substring(0, 30)}${match.length > 30 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}. Without specifying which one, I cannot safely apply this edit.\n\nSolution: Add 'occurrence: 1' to edit the first match, 'occurrence: 2' for the second, etc. Or use 'occurrence: all' to replace all matches.`
            };
          }

          // Determine which positions to use
          let targetPositions: number[] = [];
          if (occurrence === 'all') {
            targetPositions = positions;
          } else if (occurrence === 'first' || occurrence === undefined) {
            const firstPos = positions[0];
            if (firstPos !== undefined) {
              targetPositions = [firstPos];
            }
          } else if (occurrence === 'last') {
            const lastPos = positions[positions.length - 1];
            if (lastPos !== undefined) {
              targetPositions = [lastPos];
            }
          } else if (typeof occurrence === 'number') {
            if (occurrence < 1 || occurrence > positions.length) {
              return {
                success: false,
                message: `Error: Requested to replace occurrence #${occurrence}, but only found ${positions.length} occurrence${positions.length === 1 ? '' : 's'} of '${match.substring(0, 30)}${match.length > 30 ? '...' : ''}'.\n\nSolution: Use a valid occurrence number between 1 and ${positions.length}, or use 'occurrence: all' to replace all matches.`
              };
            }
            const targetPos = positions[occurrence - 1];
            if (targetPos !== undefined) {
              targetPositions = [targetPos];
            }
          }

          // Add all target positions to operation list
          for (const pos of targetPositions) {
            operationPositions.push({
              type: 'edit',
              index: i,
              start: pos,
              end: pos + match.length,
              matchText: match
            });
          }
        } else if ('pattern' in edit) {
          // Regex-based edit
          const { pattern, replace: regexReplace, flags } = edit as any;

          let regex: RegExp;
          try {
            // Validate and compile regex pattern
            regex = new RegExp(pattern, flags || '');
          } catch (error) {
            return {
              success: false,
              message: `Error: Edit #${i} contains an invalid regular expression pattern.\n\nSolution: Fix the regex pattern syntax. Error: ${error instanceof Error ? error.message : 'Unknown regex error'}. Make sure to escape special characters properly (e.g., use \\\\d for digits, \\\\s for whitespace).`
            };
          }

          // Find all matches using regex
          const matches: Array<{ index: number; match: string; groups: string[] }> = [];
          let match: RegExpExecArray | null;

          // Reset regex lastIndex
          regex.lastIndex = 0;

          while ((match = regex.exec(originalContent)) !== null) {
            matches.push({
              index: match.index,
              match: match[0],
              groups: Array.from(match)
            });

            // Prevent infinite loop for zero-width matches
            if (match.index === regex.lastIndex) {
              regex.lastIndex++;
            }

            // If regex doesn't have 'g' flag, break after first match
            if (!flags || !flags.includes('g')) {
              break;
            }
          }

          if (matches.length === 0) {
            return {
              success: false,
              message: `Error: Edit #${i}: regex pattern '${pattern.substring(0, 30)}${pattern.length > 30 ? '...' : ''}' did not match any text in the ${editFrontmatter ? 'frontmatter' : 'note'}.\n\nSolution: Verify the regex pattern matches the content you're trying to edit. Use read_note to check the current content.`
            };
          }

          // For each match, compute the replacement with capture groups
          for (const m of matches) {
            let computedReplace = regexReplace;

            // Replace $1, $2, etc. with captured groups
            for (let groupIdx = 0; groupIdx < m.groups.length; groupIdx++) {
              const group = m.groups[groupIdx];
              if (group !== undefined) {
                // Replace $N with the captured group
                computedReplace = computedReplace.replace(
                  new RegExp(`\\$${groupIdx}`, 'g'),
                  group
                );
              }
            }

            operationPositions.push({
              type: 'edit',
              index: i,
              start: m.index,
              end: m.index + m.match.length,
              matchText: m.match,
              computedReplace: computedReplace
            });
          }
        } else if ('anchor' in edit) {
          // Anchor-based edit
          const { anchor, anchorOccurrence } = edit as any;
          const { after: anchorText, offset } = anchor;

          // Find all occurrences of anchor text in ORIGINAL content
          const positions: number[] = [];
          let searchIndex = 0;
          let index = -1;

          while ((index = originalContent.indexOf(anchorText, searchIndex)) !== -1) {
            positions.push(index);
            searchIndex = index + anchorText.length;
          }

          if (positions.length === 0) {
            return {
              success: false,
              message: `Error: Could not find anchor text '${anchorText.substring(0, 50)}${anchorText.length > 50 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}.\n\nSolution: Verify the anchor text exists. Use read_note to check the current content.`
            };
          }

          // Handle anchorOccurrence parameter for multiple matches
          if (positions.length > 1 && !anchorOccurrence) {
            return {
              success: false,
              message: `Error: Found ${positions.length} occurrences of anchor text '${anchorText.substring(0, 30)}${anchorText.length > 30 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}. Without specifying which one, I cannot safely apply this edit.\n\nSolution: Add 'anchorOccurrence: 1' to use the first match, 'anchorOccurrence: 2' for the second, etc. Or use 'anchorOccurrence: last' for the final occurrence.`
            };
          }

          // Determine which anchor position to use
          let anchorPosition: number;
          if (anchorOccurrence === 'last') {
            const lastPos = positions[positions.length - 1];
            anchorPosition = lastPos !== undefined ? lastPos : positions[0]!;
          } else if (typeof anchorOccurrence === 'number') {
            if (anchorOccurrence < 1 || anchorOccurrence > positions.length) {
              return {
                success: false,
                message: `Error: Requested anchor occurrence #${anchorOccurrence}, but only found ${positions.length} occurrence${positions.length === 1 ? '' : 's'} of '${anchorText.substring(0, 30)}${anchorText.length > 30 ? '...' : ''}'.\n\nSolution: Use a valid occurrence number between 1 and ${positions.length}, or use 'anchorOccurrence: last' for the final occurrence.`
              };
            }
            const targetPos = positions[anchorOccurrence - 1];
            anchorPosition = targetPos !== undefined ? targetPos : positions[0]!;
          } else {
            // Default to first occurrence
            anchorPosition = positions[0]!;
          }

          // Find the line number of the anchor
          const lines = originalContent.split('\n');
          let anchorLine = 1;
          let charCount = 0;
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            if (line === undefined) continue;
            if (charCount + line.length >= anchorPosition) {
              anchorLine = lineIdx + 1;
              break;
            }
            charCount += line.length + 1; // +1 for newline
          }

          // Calculate target line
          const targetLine = anchorLine + offset;

          // Validate target line exists
          const lineInfo = getLineInfo(targetLine);
          if (!lineInfo) {
            return {
              success: false,
              message: `Error: Edit #${i} anchor points to line ${targetLine} (anchor at line ${anchorLine} + offset ${offset}), but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${lines.length} lines.\n\nSolution: Adjust the offset value or verify the anchor text is correct. Current anchor is at line ${anchorLine}, and offset is ${offset}.`
            };
          }

          // Treat as a match operation for the target line
          operationPositions.push({
            type: 'edit',
            index: i,
            start: lineInfo.start,
            end: lineInfo.end,
            matchText: lineInfo.content
          });
        } else {
          // Unsupported edit types
          return {
            success: false,
            message: `Error: Edit #${i} uses an unsupported edit type. Currently supports: string match (match), line number (line), regex (pattern), or anchor (anchor).\n\nSolution: Use {match: 'text to find', replace: 'new text'} for string match edits, {line: N, replace: 'text'} for line-based edits, or {anchor: {after: 'text', offset: N}, replace: 'text'} for anchor-based edits.`
          };
        }
      }

      // Find positions for all deletions
      for (let i = 0; i < deletions.length; i++) {
        const deletion = deletions[i];
        if (!deletion) continue;

        if ('line' in deletion) {
          // Line-based deletion
          const lineInfo = getLineInfo(deletion.line);
          if (!lineInfo) {
            return {
              success: false,
              message: `Error: Deletion #${i} references line ${deletion.line}, but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${originalContent.split('\n').length} lines.\n\nSolution: Use a valid line number between 1 and ${originalContent.split('\n').length}, or use read_note to check the current content.`
            };
          }

          // Delete the entire line including the newline
          operationPositions.push({
            type: 'deletion',
            index: i,
            start: lineInfo.start,
            end: lineInfo.end + (lineInfo.end < originalContent.length ? 1 : 0), // Include newline if not last line
            matchText: lineInfo.content
          });
        } else if ('startLine' in deletion && 'endLine' in deletion) {
          // Range deletion
          const startLineInfo = getLineInfo(deletion.startLine);
          const endLineInfo = getLineInfo(deletion.endLine);

          if (!startLineInfo) {
            return {
              success: false,
              message: `Error: Deletion #${i} references startLine ${deletion.startLine}, but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${originalContent.split('\n').length} lines.\n\nSolution: Use a valid line number between 1 and ${originalContent.split('\n').length}.`
            };
          }

          if (!endLineInfo) {
            return {
              success: false,
              message: `Error: Deletion #${i} references endLine ${deletion.endLine}, but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${originalContent.split('\n').length} lines.\n\nSolution: Use a valid line number between 1 and ${originalContent.split('\n').length}.`
            };
          }

          if (deletion.startLine > deletion.endLine) {
            return {
              success: false,
              message: `Error: Deletion #${i} has startLine (${deletion.startLine}) greater than endLine (${deletion.endLine}).\n\nSolution: Ensure startLine is less than or equal to endLine.`
            };
          }

          // Delete range including newlines
          operationPositions.push({
            type: 'deletion',
            index: i,
            start: startLineInfo.start,
            end: endLineInfo.end + (endLineInfo.end < originalContent.length ? 1 : 0), // Include newline if not last line
            matchText: originalContent.substring(startLineInfo.start, endLineInfo.end)
          });
        } else if ('match' in deletion) {
          const { match, occurrence } = deletion;

          // Find all occurrences in ORIGINAL content
          const positions: number[] = [];
          let searchIndex = 0;
          let index = -1;

          while ((index = originalContent.indexOf(match, searchIndex)) !== -1) {
            positions.push(index);
            searchIndex = index + match.length;
          }

          if (positions.length === 0) {
            return {
              success: false,
              message: `Error: Could not find the text '${match.substring(0, 50)}${match.length > 50 ? '...' : ''}' to delete in the ${editFrontmatter ? 'frontmatter' : 'note'}.\n\nSolution: Double-check the exact text you're trying to delete, including capitalization and whitespace. Use the read_note tool to verify the current content.`
            };
          }

          // Handle occurrence parameter
          if (positions.length > 1 && !occurrence) {
            return {
              success: false,
              message: `Error: Found ${positions.length} occurrences of '${match.substring(0, 30)}${match.length > 30 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}. Without specifying which one, I cannot safely delete.\n\nSolution: Add 'occurrence: 1' to delete the first match, 'occurrence: 2' for the second, etc. Or use 'occurrence: all' to delete all matches.`
            };
          }

          // Determine which positions to use
          let targetPositions: number[] = [];
          if (occurrence === 'all') {
            targetPositions = positions;
          } else if (occurrence === 'first' || occurrence === undefined) {
            const firstPos = positions[0];
            if (firstPos !== undefined) {
              targetPositions = [firstPos];
            }
          } else if (occurrence === 'last') {
            const lastPos = positions[positions.length - 1];
            if (lastPos !== undefined) {
              targetPositions = [lastPos];
            }
          } else if (typeof occurrence === 'number') {
            if (occurrence < 1 || occurrence > positions.length) {
              return {
                success: false,
                message: `Error: Requested to delete occurrence #${occurrence}, but only found ${positions.length} occurrence${positions.length === 1 ? '' : 's'} of '${match.substring(0, 30)}${match.length > 30 ? '...' : ''}'.\n\nSolution: Use a valid occurrence number between 1 and ${positions.length}, or use 'occurrence: all' to delete all matches.`
              };
            }
            const targetPos = positions[occurrence - 1];
            if (targetPos !== undefined) {
              targetPositions = [targetPos];
            }
          }

          // Add all target positions to operation list
          for (const pos of targetPositions) {
            operationPositions.push({
              type: 'deletion',
              index: i,
              start: pos,
              end: pos + match.length,
              matchText: match
            });
          }
        } else if ('anchor' in deletion) {
          // Anchor-based deletion
          const { anchor, anchorOccurrence } = deletion as any;
          const { after: anchorText, offset } = anchor;

          // Find all occurrences of anchor text in ORIGINAL content
          const positions: number[] = [];
          let searchIndex = 0;
          let index = -1;

          while ((index = originalContent.indexOf(anchorText, searchIndex)) !== -1) {
            positions.push(index);
            searchIndex = index + anchorText.length;
          }

          if (positions.length === 0) {
            return {
              success: false,
              message: `Error: Could not find anchor text '${anchorText.substring(0, 50)}${anchorText.length > 50 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}.\n\nSolution: Verify the anchor text exists. Use read_note to check the current content.`
            };
          }

          // Handle anchorOccurrence parameter for multiple matches
          if (positions.length > 1 && !anchorOccurrence) {
            return {
              success: false,
              message: `Error: Found ${positions.length} occurrences of anchor text '${anchorText.substring(0, 30)}${anchorText.length > 30 ? '...' : ''}' in the ${editFrontmatter ? 'frontmatter' : 'note'}. Without specifying which one, I cannot safely apply this deletion.\n\nSolution: Add 'anchorOccurrence: 1' to use the first match, 'anchorOccurrence: 2' for the second, etc. Or use 'anchorOccurrence: last' for the final occurrence.`
            };
          }

          // Determine which anchor position to use
          let anchorPosition: number;
          if (anchorOccurrence === 'last') {
            const lastPos = positions[positions.length - 1];
            anchorPosition = lastPos !== undefined ? lastPos : positions[0]!;
          } else if (typeof anchorOccurrence === 'number') {
            if (anchorOccurrence < 1 || anchorOccurrence > positions.length) {
              return {
                success: false,
                message: `Error: Requested anchor occurrence #${anchorOccurrence}, but only found ${positions.length} occurrence${positions.length === 1 ? '' : 's'} of '${anchorText.substring(0, 30)}${anchorText.length > 30 ? '...' : ''}'.\n\nSolution: Use a valid occurrence number between 1 and ${positions.length}, or use 'anchorOccurrence: last' for the final occurrence.`
              };
            }
            const targetPos = positions[anchorOccurrence - 1];
            anchorPosition = targetPos !== undefined ? targetPos : positions[0]!;
          } else {
            // Default to first occurrence
            anchorPosition = positions[0]!;
          }

          // Find the line number of the anchor
          const lines = originalContent.split('\n');
          let anchorLine = 1;
          let charCount = 0;
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            if (line === undefined) continue;
            if (charCount + line.length >= anchorPosition) {
              anchorLine = lineIdx + 1;
              break;
            }
            charCount += line.length + 1; // +1 for newline
          }

          // Calculate target line
          const targetLine = anchorLine + offset;

          // Validate target line exists
          const lineInfo = getLineInfo(targetLine);
          if (!lineInfo) {
            return {
              success: false,
              message: `Error: Deletion #${i} anchor points to line ${targetLine} (anchor at line ${anchorLine} + offset ${offset}), but the ${editFrontmatter ? 'frontmatter' : 'content'} only has ${lines.length} lines.\n\nSolution: Adjust the offset value or verify the anchor text is correct. Current anchor is at line ${anchorLine}, and offset is ${offset}.`
            };
          }

          // Delete the entire target line including the newline
          operationPositions.push({
            type: 'deletion',
            index: i,
            start: lineInfo.start,
            end: lineInfo.end + (lineInfo.end < originalContent.length ? 1 : 0), // Include newline if not last line
            matchText: lineInfo.content
          });
        } else {
          // Unsupported deletion types
          return {
            success: false,
            message: `Error: Deletion #${i} uses an unsupported deletion type. Currently supports: string match (match), line number (line), line range (startLine/endLine), or anchor (anchor).\n\nSolution: Use {match: 'text to delete'} for string match deletions, {line: N} for line-based deletions, {startLine: N, endLine: M} for range deletions, or {anchor: {after: 'text', offset: N}} for anchor-based deletions.`
          };
        }
      }

      // CONFLICT DETECTION: Check for overlapping operations
      for (let i = 0; i < operationPositions.length; i++) {
        for (let j = i + 1; j < operationPositions.length; j++) {
          const op1 = operationPositions[i];
          const op2 = operationPositions[j];

          if (!op1 || !op2) continue;

          // Check if ranges overlap
          const overlaps = (op1.start < op2.end && op1.end > op2.start);

          if (overlaps) {
            const op1Label = op1.type === 'edit' ? `Edit #${op1.index}` : `Deletion #${op1.index}`;
            const op2Label = op2.type === 'edit' ? `edit #${op2.index}` : `deletion #${op2.index}`;

            return {
              success: false,
              message: `Error: ${op1Label} and ${op2Label} attempt to modify overlapping text, which would cause unpredictable results.\n\nSolution: Adjust your edits and deletions so they don't modify overlapping text. Remove one of the conflicting operations or change what text they target.`
            };
          }
        }
      }

      // BOTTOM-UP APPLICATION: Sort operations by position (descending)
      operationPositions.sort((a, b) => b.start - a.start);

      // Apply all operations from bottom to top
      let modifiedContent = originalContent;

      for (const op of operationPositions) {
        if (op.type === 'edit') {
          const edit = edits[op.index];
          if (!edit || !('replace' in edit)) continue;

          // Use precomputed replacement for regex, otherwise use the replace field
          let replace = op.computedReplace !== undefined ? op.computedReplace : edit.replace;

          // Apply preserveIndentation if enabled (not for regex edits which handle their own replacement)
          if (preserveIndentation && !op.computedReplace && op.matchText) {
            // Detect leading whitespace in the matched text
            const leadingWhitespaceMatch = op.matchText.match(/^(\s*)/);
            const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';

            if (leadingWhitespace) {
              // Apply same indentation to ALL lines in replacement (including first line)
              const replacementLines = replace.split('\n');
              replace = replacementLines
                .map((line) => {
                  // Trim the line first, then add the indentation to all non-empty lines
                  const trimmed = line.trim();
                  return trimmed ? leadingWhitespace + trimmed : line;
                })
                .join('\n');
            }
          }

          // Apply the edit at the specific position
          modifiedContent =
            modifiedContent.substring(0, op.start) +
            replace +
            modifiedContent.substring(op.end);

          editsApplied++;
        } else if (op.type === 'deletion') {
          // Apply the deletion at the specific position
          modifiedContent =
            modifiedContent.substring(0, op.start) +
            modifiedContent.substring(op.end);

          deletionsApplied++;
        }
      }

      // Write back the modified content
      if (editFrontmatter) {
        // Parse the modified YAML back into frontmatter object
        try {
          // Use gray-matter to parse the modified YAML
          const yaml = await import('yaml');
          let modifiedFrontmatter: Record<string, any> = {};

          if (modifiedContent.trim()) {
            // Parse YAML string into object
            modifiedFrontmatter = yaml.parse(modifiedContent);
          }

          // Validate the modified frontmatter
          const validation = this.frontmatterHandler.validate(modifiedFrontmatter);
          if (!validation.isValid) {
            return {
              success: false,
              message: `Error: The edited frontmatter is not valid YAML: ${validation.errors.join(', ')}\n\nSolution: Check the YAML syntax in your edits. Common issues include incorrect indentation, missing colons, or invalid characters.`
            };
          }

          // ATOMIC WRITE: Write once at the end with modified frontmatter
          await this.writeNote({
            path,
            content: note.content,  // Preserve original content
            frontmatter: modifiedFrontmatter,
            mode: 'overwrite'
          });
        } catch (error) {
          return {
            success: false,
            message: `Error: Failed to parse modified frontmatter as YAML: ${error instanceof Error ? error.message : 'Unknown error'}\n\nSolution: Ensure your edits produce valid YAML syntax. Check for proper indentation, colons after keys, and correctly quoted strings.`
          };
        }
      } else {
        // ATOMIC WRITE: Write once at the end
        await this.writeNote({
          path,
          content: modifiedContent,
          frontmatter: note.frontmatter,
          mode: 'overwrite'
        });
      }

      // Build success message
      const target = editFrontmatter ? 'frontmatter in' : '';
      let message = '';
      if (editsApplied > 0 && deletionsApplied > 0) {
        message = `Applied ${editsApplied} edit${editsApplied === 1 ? '' : 's'} and ${deletionsApplied} deletion${deletionsApplied === 1 ? '' : 's'} to ${target ? target + ' ' : ''}${path}`;
      } else if (editsApplied > 0) {
        message = `Applied ${editsApplied} edit${editsApplied === 1 ? '' : 's'} to ${target ? target + ' ' : ''}${path}`;
      } else if (deletionsApplied > 0) {
        message = `Applied ${deletionsApplied} deletion${deletionsApplied === 1 ? '' : 's'} to ${target ? target + ' ' : ''}${path}`;
      }

      return {
        success: true,
        path,
        editsApplied,
        deletionsApplied,
        message
      };

    } catch (error) {
      return {
        success: false,
        message: `Error: Failed to edit note: ${error instanceof Error ? error.message : 'Unknown error'}\n\nSolution: Check that the file exists and you have permission to write to it. Use read_note to verify the file is accessible.`
      };
    }
  }

  /**
   * Lists files and directories in the specified vault directory.
   *
   * Respects PathFilter settings and returns sorted results.
   * Filters out symlinks and other special file types.
   *
   * @param path - Relative path to directory within vault. Defaults to root ('') if not specified. Use '.' for root.
   * @returns DirectoryListing containing sorted arrays of file and directory names
   * @throws Error if directory not found, permission denied, or path is not a directory
   */
  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Normalize path: treat '.' as root directory
    const normalizedPath = path === '.' ? '' : path;
    const fullPath = this.resolvePath(normalizedPath);

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      const files: string[] = [];
      const directories: string[] = [];

      for (const entry of entries) {
        const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;

        if (!this.pathFilter.isAllowed(entryPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          directories.push(entry.name);
        } else if (entry.isFile()) {
          files.push(entry.name);
        }
        // Skip other types (symlinks, etc.)
      }

      return {
        files: files.sort(),
        directories: directories.sort()
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('ENOENT')) {
          throw new Error(`Directory not found: ${path}`);
        }
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}`);
        }
        if (error.message.includes('not a directory') || error.message.includes('ENOTDIR')) {
          throw new Error(`Not a directory: ${path}`);
        }
      }
      throw new Error(`Failed to list directory: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Checks if a file or directory exists at the specified path.
   *
   * Respects PathFilter settings - returns false for disallowed paths.
   *
   * @param path - Relative path within vault to check
   * @returns true if path exists and is allowed, false otherwise
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      await access(fullPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if the specified path is a directory.
   *
   * Respects PathFilter settings - returns false for disallowed paths.
   *
   * @param path - Relative path within vault to check
   * @returns true if path exists and is a directory (and allowed), false otherwise
   */
  async isDirectory(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      const stats = await stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Deletes a note from the vault with confirmation requirement.
   *
   * Requires confirmPath to exactly match path for safety.
   * Cannot delete directories - only files.
   *
   * @param params - DeleteNoteParams containing path and confirmPath (must match)
   * @returns DeleteResult indicating success/failure with descriptive message
   */
  async deleteNote(params: DeleteNoteParams): Promise<DeleteResult> {
    const { path, confirmPath } = params;

    // Confirmation check - paths must match exactly
    if (path !== confirmPath) {
      return {
        success: false,
        path: path,
        message: "Deletion cancelled: confirmation path does not match. For safety, both 'path' and 'confirmPath' must be identical."
      };
    }

    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path: path,
        message: `Access denied: ${path}`
      };
    }

    try {
      // Check if it's a directory first (can't delete directories with this method)
      const isDir = await this.isDirectory(path);
      if (isDir) {
        return {
          success: false,
          path: path,
          message: `Cannot delete: ${path} is not a file`
        };
      }

      // Check if file exists
      try {
        await access(fullPath, constants.F_OK);
      } catch {
        return {
          success: false,
          path: path,
          message: `File not found: ${path}`
        };
      }

      // Perform the deletion using Node.js native API
      await unlink(fullPath);

      return {
        success: true,
        path: path,
        message: `Successfully deleted note: ${path}. This action cannot be undone.`
      };

    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            path: path,
            message: `File not found: ${path}`
          };
        }
        if (error.code === 'EACCES') {
          return {
            success: false,
            path: path,
            message: `Permission denied: ${path}`
          };
        }
      }
      return {
        success: false,
        path: path,
        message: `Failed to delete file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Moves or renames a note within the vault.
   *
   * Creates target directories if they don't exist.
   * Verifies write success before deleting source file.
   *
   * @param params - MoveNoteParams containing oldPath, newPath, and optional overwrite flag
   * @returns MoveResult indicating success/failure with descriptive message
   */
  async moveNote(params: MoveNoteParams): Promise<MoveResult> {
    const { oldPath, newPath, overwrite = false } = params;

    if (!this.pathFilter.isAllowed(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${oldPath}`
      };
    }

    if (!this.pathFilter.isAllowed(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${newPath}`
      };
    }

    const oldFullPath = this.resolvePath(oldPath);
    const newFullPath = this.resolvePath(newPath);

    try {
      // Check if source file exists
      try {
        await access(oldFullPath, constants.F_OK);
      } catch {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Source file not found: ${oldPath}`
        };
      }

      // Check if target already exists
      let targetExists = false;
      try {
        await access(newFullPath, constants.F_OK);
        targetExists = true;
      } catch {
        // Target doesn't exist, which is fine
      }

      if (targetExists && !overwrite) {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.`
        };
      }

      // Read source content
      const content = await readFile(oldFullPath, 'utf-8');

      // Write to new location (create directories if they don't exist)
      await mkdir(dirname(newFullPath), { recursive: true });
      await writeFile(newFullPath, content, 'utf-8');

      // Verify the write was successful
      try {
        await access(newFullPath, constants.F_OK);
      } catch {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Failed to create target file: ${newPath}`
        };
      }

      // Delete the source file
      await unlink(oldFullPath);

      return {
        success: true,
        oldPath,
        newPath,
        message: `Successfully moved note from ${oldPath} to ${newPath}`
      };

    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Reads multiple notes in a single batch operation.
   *
   * Continues reading even if some files fail - returns both successful and failed results.
   * Maximum 10 files per batch to prevent excessive memory usage.
   *
   * @param params - BatchReadParams containing paths array and optional include flags
   * @returns BatchReadResult with successful reads and failed reads (with error messages)
   * @throws Error if more than 10 paths provided
   */
  async readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult> {
    const { paths, includeContent = true, includeFrontmatter = true } = params;

    if (paths.length > 10) {
      throw new Error('Maximum 10 files per batch read request');
    }

    const results = await Promise.allSettled(
      paths.map(async (path) => {
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}`);
        }

        const note = await this.readNote(path);
        const result: any = { path };

        if (includeFrontmatter) {
          result.frontmatter = note.frontmatter;
        }

        if (includeContent) {
          result.content = note.content;
        }

        return result;
      })
    );

    const successful: Array<{ path: string; frontmatter?: Record<string, any>; content?: string; }> = [];
    const failed: Array<{ path: string; error: string; }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          path: paths[index] || '',
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        });
      }
    });

    return { successful, failed };
  }

  /**
   * Updates the frontmatter of a note without changing its content.
   *
   * Supports merge mode (default) to combine with existing frontmatter,
   * or replace mode to completely replace frontmatter.
   *
   * @param params - UpdateFrontmatterParams containing path, frontmatter object, and optional merge flag
   * @throws Error if access denied, invalid frontmatter, or write fails
   */
  async updateFrontmatter(params: UpdateFrontmatterParams): Promise<void> {
    const { path, frontmatter, merge = true } = params;

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}`);
    }

    // Read the existing note
    const note = await this.readNote(path);

    // Prepare new frontmatter
    const newFrontmatter = merge
      ? { ...note.frontmatter, ...frontmatter }
      : frontmatter;

    // Validate the new frontmatter
    const validation = this.frontmatterHandler.validate(newFrontmatter);
    if (!validation.isValid) {
      throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
    }

    // Update the note with new frontmatter, preserving content
    await this.writeNote({
      path,
      content: note.content,
      frontmatter: newFrontmatter
    });
  }

  /**
   * Gets metadata for multiple notes without reading full content.
   *
   * Efficiently checks file size, modification time, and frontmatter presence
   * by reading only the first 100 characters of each file.
   * Returns only successful results - failed reads are filtered out.
   *
   * @param paths - Array of relative paths to get info for
   * @returns Array of NoteInfo objects for successfully accessed files
   */
  async getNotesInfo(paths: string[]): Promise<NoteInfo[]> {
    const results = await Promise.allSettled(
      paths.map(async (path): Promise<NoteInfo> => {
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}`);
        }

        const fullPath = this.resolvePath(path);

        try {
          await access(fullPath, constants.F_OK);
        } catch {
          throw new Error(`File not found: ${path}`);
        }

        const stats = await stat(fullPath);
        const size = stats.size;
        const lastModified = stats.mtime.getTime();

        // Quick check for frontmatter without reading full content
        const file = await readFile(fullPath, 'utf-8');
        const firstChunk = file.slice(0, 100);
        const hasFrontmatter = firstChunk.startsWith('---\n');

        return {
          path,
          size,
          modified: lastModified,
          hasFrontmatter
        };
      })
    );

    // Return only successful results, filter out failed ones
    return results
      .filter((result): result is PromiseFulfilledResult<NoteInfo> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Manages tags in a note's frontmatter.
   *
   * Supports three operations:
   * - 'list': Returns all tags from frontmatter and inline tags from content
   * - 'add': Adds tags to frontmatter (deduplicates)
   * - 'remove': Removes tags from frontmatter
   *
   * @param params - TagManagementParams containing path, operation, and optional tags array
   * @returns TagManagementResult with operation results and current tags
   */
  async manageTags(params: TagManagementParams): Promise<TagManagementResult> {
    const { path, operation, tags = [] } = params;

    if (!this.pathFilter.isAllowed(path)) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: `Access denied: ${path}`
      };
    }

    try {
      const note = await this.readNote(path);
      let currentTags: string[] = [];

      // Extract tags from frontmatter
      if (note.frontmatter.tags) {
        if (Array.isArray(note.frontmatter.tags)) {
          currentTags = note.frontmatter.tags;
        } else if (typeof note.frontmatter.tags === 'string') {
          currentTags = [note.frontmatter.tags];
        }
      }

      // Also extract inline tags from content
      const inlineTagMatches = note.content.match(/#[a-zA-Z0-9_-]+/g) || [];
      const inlineTags = inlineTagMatches.map(tag => tag.slice(1)); // Remove #
      currentTags = [...new Set([...currentTags, ...inlineTags])]; // Deduplicate

      if (operation === 'list') {
        return {
          path,
          operation,
          tags: currentTags,
          success: true,
          message: `Found ${currentTags.length} tag${currentTags.length === 1 ? '' : 's'}`
        };
      }

      let newTags = [...currentTags];

      if (operation === 'add') {
        for (const tag of tags) {
          if (!newTags.includes(tag)) {
            newTags.push(tag);
          }
        }
      } else if (operation === 'remove') {
        newTags = newTags.filter(tag => !tags.includes(tag));
      }

      // Update frontmatter with new tags
      const updatedFrontmatter: Record<string, any> = {
        ...note.frontmatter
      };

      if (newTags.length > 0) {
        updatedFrontmatter.tags = newTags;
      } else if ('tags' in updatedFrontmatter) {
        delete updatedFrontmatter.tags;
      }

      // Write back the note with updated frontmatter
      await this.writeNote({
        path,
        content: note.content,
        frontmatter: updatedFrontmatter,
        mode: 'overwrite'
      });

      return {
        path,
        operation,
        tags: newTags,
        success: true,
        message: `Successfully ${operation === 'add' ? 'added' : 'removed'} tags`
      };

    } catch (error) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Returns the absolute path to the vault root directory.
   *
   * @returns Absolute path to the Obsidian vault
   */
  getVaultPath(): string {
    return this.vaultPath;
  }
}