import type { PathFilterConfig } from "./types.js";

export class PathFilter {
  private ignoredPatterns: string[];
  private allowedExtensions: string[];

  /**
   * Creates a new PathFilter for controlling file access in the vault.
   *
   * Default ignored patterns: .obsidian/**, .git/**, node_modules/**, .DS_Store, Thumbs.db
   * Default allowed extensions: .md, .markdown, .txt
   *
   * @param config - Optional configuration to extend defaults
   */
  constructor(config?: Partial<PathFilterConfig>) {
    this.ignoredPatterns = [
      '.obsidian/**',
      '.git/**',
      'node_modules/**',
      '.DS_Store',
      'Thumbs.db',
      ...config?.ignoredPatterns || []
    ];

    this.allowedExtensions = [
      '.md',
      '.markdown',
      '.txt',
      ...config?.allowedExtensions || []
    ];
  }

  /**
   * Matches a path against a glob pattern.
   *
   * Supports ** (any directories), * (anything except /), ? (single char except /)
   *
   * @param pattern - Glob pattern to match against
   * @param path - Path to test
   * @returns true if path matches pattern
   */
  private simpleGlobMatch(pattern: string, path: string): boolean {
    let regexPattern = pattern
      .replace(/\*\*/g, '.*')  // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/\?/g, '[^/]')  // ? matches single character except /
      .replace(/\./g, '\\.');

    // Ensure we match the full path
    regexPattern = '^' + regexPattern + '$';

    const regex = new RegExp(regexPattern);
    return regex.test(path);
  }

  /**
   * Checks if a path is allowed based on ignore patterns and file extensions.
   *
   * @param path - Relative path to check
   * @returns true if path is allowed (not ignored and has valid extension)
   */
  isAllowed(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/');

    for (const pattern of this.ignoredPatterns) {
      if (this.simpleGlobMatch(pattern, normalizedPath)) {
        return false;
      }
    }

    if (this.allowedExtensions.length > 0 && this.isFile(normalizedPath)) {
      const hasAllowedExtension = this.allowedExtensions.some(ext =>
        normalizedPath.toLowerCase().endsWith(ext.toLowerCase())
      );
      if (!hasAllowedExtension) {
        return false;
      }
    }

    return true;
  }

  /**
   * Heuristically determines if a path represents a file.
   *
   * @param path - Path to check
   * @returns true if path appears to be a file (contains '.' and doesn't end with '/')
   */
  private isFile(path: string): boolean {
    return path.includes('.') && !path.endsWith('/');
  }

  /**
   * Filters an array of paths to include only allowed paths.
   *
   * @param paths - Array of paths to filter
   * @returns Array of paths that pass the isAllowed check
   */
  filterPaths(paths: string[]): string[] {
    return paths.filter(path => this.isAllowed(path));
  }
}