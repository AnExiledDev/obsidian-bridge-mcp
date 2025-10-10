import { join } from 'path';
import { readFile, readdir } from 'node:fs/promises';
import type { PathFilter } from './pathfilter.js';
import type { SearchParams, SearchResult } from './types.js';

export class SearchService {
  /**
   * Creates a new SearchService for searching notes in the vault.
   *
   * @param vaultPath - Absolute path to the vault root directory
   * @param pathFilter - PathFilter instance for controlling file access
   */
  constructor(
    private vaultPath: string,
    private pathFilter: PathFilter
  ) {}

  /**
   * Searches for notes matching the query in the vault.
   *
   * Searches only allowed files and returns results with excerpts and match counts.
   * Maximum limit is capped at 20 results.
   *
   * @param params - SearchParams containing query and search options
   * @returns Array of SearchResult objects with paths, excerpts, and match info
   * @throws Error if query is empty
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const {
      query,
      limit = 5,
      searchContent = true,
      searchFrontmatter = false,
      caseSensitive = false
    } = params;

    if (!query || query.trim().length === 0) {
      throw new Error('Search query cannot be empty');
    }

    const results: SearchResult[] = [];
    const maxLimit = Math.min(limit, 20);

    const markdownFiles = await this.findMarkdownFiles(this.vaultPath);

    for (const fullPath of markdownFiles) {
      // Convert absolute path back to relative path
      const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');

      if (!this.pathFilter.isAllowed(relativePath)) continue;
      if (results.length >= maxLimit) break;

      try {
        const content = await readFile(fullPath, 'utf-8');
        let searchableText = '';

        if (searchContent && searchFrontmatter) {
          searchableText = content;
        } else if (searchContent) {
          // Remove frontmatter from search
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
          searchableText = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
        } else if (searchFrontmatter) {
          // Search only frontmatter
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
          searchableText = frontmatterMatch ? frontmatterMatch[1] || '' : '';
        }

        const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();
        const searchQuery = caseSensitive ? query : query.toLowerCase();

        const index = searchIn.indexOf(searchQuery);
        if (index !== -1) {
          const excerptStart = Math.max(0, index - 50);
          const excerptEnd = Math.min(searchableText.length, index + searchQuery.length + 50);
          let excerpt = searchableText.slice(excerptStart, excerptEnd).trim();

          if (excerptStart > 0) excerpt = '...' + excerpt;
          if (excerptEnd < searchableText.length) excerpt = excerpt + '...';

          let matchCount = 0;
          let searchIndex = 0;
          while ((searchIndex = searchIn.indexOf(searchQuery, searchIndex)) !== -1) {
            matchCount++;
            searchIndex += searchQuery.length;
          }

          const lines = searchableText.slice(0, index).split('\n');
          const lineNumber = lines.length;

          const title = relativePath.split('/').pop()?.replace(/\.md$/, '') || relativePath;

          results.push({
            path: relativePath,
            title: title,
            excerpt: excerpt,
            matchCount: matchCount,
            lineNumber: lineNumber
          });
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    return results;
  }

  /**
   * Recursively finds all .md files in a directory and its subdirectories.
   *
   * @param dirPath - Absolute path to directory to search
   * @returns Array of absolute paths to markdown files
   */
  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const markdownFiles: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.findMarkdownFiles(fullPath);
          markdownFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          markdownFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }

    return markdownFiles;
  }
}