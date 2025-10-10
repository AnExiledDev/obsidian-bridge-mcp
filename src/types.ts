/**
 * Represents a parsed note with separated frontmatter and content.
 *
 * @property frontmatter - Parsed YAML frontmatter as key-value object
 * @property content - Note content without frontmatter
 * @property originalContent - Complete file content including frontmatter delimiters
 */
export interface ParsedNote {
  frontmatter: Record<string, any>;
  content: string;
  originalContent: string;
}

/**
 * Parameters for writing a note to the vault.
 *
 * @property path - Relative path to the note within the vault
 * @property content - Note content (without frontmatter)
 * @property frontmatter - Optional frontmatter metadata as key-value object
 * @property mode - Write mode: 'overwrite' (default), 'append', or 'prepend'
 */
export interface NoteWriteParams {
  path: string;
  content: string;
  frontmatter?: Record<string, any>;
  mode?: 'overwrite' | 'append' | 'prepend';
}

/**
 * Parameters for patching (replacing text in) a note.
 *
 * @property path - Relative path to the note within the vault
 * @property oldString - Exact string to find and replace
 * @property newString - Replacement string
 * @property replaceAll - If true, replace all occurrences. If false, fails when multiple matches found (default: false)
 */
export interface PatchNoteParams {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/**
 * Result from patching a note.
 * @property message - Plain text message following MCP standards.
 *   Success format: "Successfully replaced N occurrence(s) in path"
 *   Error format: "Error: [description]\n\nSolution: [guidance]"
 */
export interface PatchNoteResult {
  success: boolean;
  path: string;
  message: string;
  matchCount?: number;
}

/**
 * Parameters for deleting a note from the vault.
 *
 * @property path - Relative path to the note to delete
 * @property confirmPath - Must exactly match path for safety confirmation
 */
export interface DeleteNoteParams {
  path: string;
  confirmPath: string;
}

/**
 * Result from deleting a note.
 * @property message - Plain text message following MCP standards.
 *   Success format: "Successfully deleted note: path. This action cannot be undone."
 *   Error format: "Error: [description]\n\nSolution: [guidance]"
 */
export interface DeleteResult {
  success: boolean;
  path: string;
  message: string;
}

/**
 * Represents the contents of a directory.
 *
 * @property files - Sorted array of file names in the directory
 * @property directories - Sorted array of subdirectory names
 */
export interface DirectoryListing {
  files: string[];
  directories: string[];
}

/**
 * Result of validating frontmatter YAML.
 *
 * @property isValid - True if frontmatter is valid and can be serialized
 * @property errors - Array of error messages (empty if valid)
 * @property warnings - Array of warning messages for potential issues
 */
export interface FrontmatterValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Configuration for filtering file paths.
 *
 * @property ignoredPatterns - Array of glob patterns for paths to ignore/block
 * @property allowedExtensions - Array of allowed file extensions (e.g., ['.md', '.txt'])
 */
export interface PathFilterConfig {
  ignoredPatterns: string[];
  allowedExtensions: string[];
}

/**
 * Parameters for searching notes in the vault.
 *
 * @property query - Search query string
 * @property limit - Maximum number of results to return (default: 5)
 * @property searchContent - Whether to search in note content (default: true)
 * @property searchFrontmatter - Whether to search in frontmatter (default: false)
 * @property caseSensitive - Whether search is case-sensitive (default: false)
 */
export interface SearchParams {
  query: string;
  limit?: number;
  searchContent?: boolean;
  searchFrontmatter?: boolean;
  caseSensitive?: boolean;
}

/**
 * Represents a single search result.
 *
 * @property path - Relative path to the matching note
 * @property title - Note title (extracted from filename)
 * @property excerpt - Text excerpt showing context around the first match
 * @property matchCount - Total number of matches found in the note
 * @property lineNumber - Line number of the first match (if applicable)
 */
export interface SearchResult {
  path: string;
  title: string;
  excerpt: string;
  matchCount: number;
  lineNumber?: number;
}

/**
 * Parameters for moving or renaming a note.
 *
 * @property oldPath - Current relative path to the note
 * @property newPath - New relative path for the note
 * @property overwrite - If true, overwrite existing file at newPath (default: false)
 */
export interface MoveNoteParams {
  oldPath: string;
  newPath: string;
  overwrite?: boolean;
}

/**
 * Result from moving/renaming a note.
 * @property message - Plain text message following MCP standards.
 *   Success format: "Successfully moved note from oldPath to newPath"
 *   Error format: "Error: [description]\n\nSolution: [guidance]"
 */
export interface MoveResult {
  success: boolean;
  oldPath: string;
  newPath: string;
  message: string;
}

/**
 * Parameters for reading multiple notes in a batch.
 *
 * @property paths - Array of relative paths to read (max 10)
 * @property includeContent - Whether to include note content in results (default: true)
 * @property includeFrontmatter - Whether to include frontmatter in results (default: true)
 */
export interface BatchReadParams {
  paths: string[];
  includeContent?: boolean;
  includeFrontmatter?: boolean;
}

/**
 * Result of a batch read operation.
 *
 * @property successful - Array of successfully read notes with their data
 * @property failed - Array of failed reads with error messages
 */
export interface BatchReadResult {
  successful: Array<{
    path: string;
    frontmatter?: Record<string, any>;
    content?: string;
  }>;
  failed: Array<{
    path: string;
    error: string;
  }>;
}

/**
 * Parameters for updating note frontmatter.
 *
 * @property path - Relative path to the note
 * @property frontmatter - Frontmatter object to set or merge
 * @property merge - If true, merge with existing frontmatter; if false, replace entirely (default: true)
 */
export interface UpdateFrontmatterParams {
  path: string;
  frontmatter: Record<string, any>;
  merge?: boolean;
}

/**
 * Metadata about a note without reading full content.
 *
 * @property path - Relative path to the note
 * @property size - File size in bytes
 * @property modified - Last modification timestamp (Unix time in milliseconds)
 * @property hasFrontmatter - True if note has YAML frontmatter
 */
export interface NoteInfo {
  path: string;
  size: number;
  modified: number; // timestamp
  hasFrontmatter: boolean;
}

/**
 * Parameters for managing tags in a note.
 *
 * @property path - Relative path to the note
 * @property operation - Operation to perform: 'add', 'remove', or 'list'
 * @property tags - Array of tags to add/remove (required for 'add' and 'remove')
 */
export interface TagManagementParams {
  path: string;
  operation: 'add' | 'remove' | 'list';
  tags?: string[];
}

/**
 * Result from tag management operations.
 * @property message - Plain text message following MCP standards.
 *   Success format: "Successfully [added/removed/listed] tags" or "Tags in path: [list]"
 *   Error format: "Error: [description]\n\nSolution: [guidance]"
 */
export interface TagManagementResult {
  path: string;
  operation: string;
  tags: string[];
  success: boolean;
  message: string;
}

/**
 * Parameters for atomic multi-edit operations on a note.
 *
 * @property path - Relative path to the note
 * @property edits - Array of edit operations to apply (max 10)
 * @property deletions - Array of deletion operations to apply (max 10)
 * @property options - Optional settings for edit behavior
 */
export interface EditNoteParams {
  path: string;
  edits?: EditOperation[];
  deletions?: DeletionOperation[];
  options?: {
    preserveIndentation?: boolean;
    editFrontmatter?: boolean;
  };
}

/**
 * Represents a single edit operation.
 *
 * Supports four edit types:
 * - String match: Find and replace specific text
 * - Line-based: Replace entire line by line number
 * - Regex: Pattern-based replacement with capture groups
 * - Anchor: Replace line relative to anchor text
 */
export type EditOperation =
  | { match: string; replace: string; occurrence?: "first" | "last" | "all" | number }
  | { line: number; replace: string }
  | { pattern: string; replace: string; regex: true; flags?: string }
  | { anchor: { after: string; offset: number }; replace: string; anchorOccurrence?: "first" | "last" | number };

/**
 * Represents a single deletion operation.
 *
 * Supports four deletion types:
 * - String match: Delete specific text
 * - Line-based: Delete line by line number
 * - Range: Delete multiple lines from startLine to endLine
 * - Anchor: Delete line relative to anchor text
 */
export type DeletionOperation =
  | { match: string; occurrence?: "first" | "last" | "all" | number }
  | { line: number }
  | { startLine: number; endLine: number }
  | { anchor: { after: string; offset: number }; anchorOccurrence?: "first" | "last" | number };

/**
 * Result from editing a note with multiple operations.
 * @property message - Plain text message following MCP standards.
 *   Success format: "Applied N edits and M deletions to path"
 *   Error format: "Error: [description]\n\nSolution: [guidance]"
 *   All errors include actionable guidance for resolution.
 */
export interface EditNoteResult {
  success: boolean;
  path?: string;
  editsApplied?: number;
  deletionsApplied?: number;
  message: string;
}