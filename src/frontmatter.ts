import matter from 'gray-matter';
import type { ParsedNote, FrontmatterValidationResult } from './types.js';

export class FrontmatterHandler {
  /**
   * Parses file content into frontmatter and content sections.
   *
   * @param content - Complete file content potentially including frontmatter
   * @returns ParsedNote with separated frontmatter, content, and original content
   */
  parse(content: string): ParsedNote {
    try {
      const parsed = matter(content);
      return {
        frontmatter: parsed.data,
        content: parsed.content,
        originalContent: content
      };
    } catch (error) {
      // If parsing fails, treat as content without frontmatter
      return {
        frontmatter: {},
        content: content,
        originalContent: content
      };
    }
  }

  /**
   * Combines frontmatter and content into a complete note string.
   *
   * @param frontmatterData - Frontmatter object to serialize as YAML
   * @param content - Note content (without frontmatter)
   * @returns Complete note string with YAML frontmatter delimiters
   * @throws Error if frontmatter cannot be serialized
   */
  stringify(frontmatterData: Record<string, any>, content: string): string {
    try {
      // If no frontmatter, return content as-is
      if (!frontmatterData || Object.keys(frontmatterData).length === 0) {
        return content;
      }

      return matter.stringify(content, frontmatterData);
    } catch (error) {
      throw new Error(`Failed to stringify frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates frontmatter to ensure it can be serialized as valid YAML.
   *
   * Checks for functions, symbols, invalid dates, and non-string keys.
   *
   * @param frontmatterData - Frontmatter object to validate
   * @returns FrontmatterValidationResult with validity status, errors, and warnings
   */
  validate(frontmatterData: Record<string, any>): FrontmatterValidationResult {
    const result: FrontmatterValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      matter.stringify('', frontmatterData);
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Invalid YAML structure: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    this.checkForProblematicValues(frontmatterData, result, '');

    return result;
  }

  /**
   * Recursively checks for problematic values in frontmatter object.
   *
   * Detects functions, symbols, invalid dates, non-string keys, and nested issues.
   *
   * @param obj - Object/value to check
   * @param result - Validation result object to populate with errors/warnings
   * @param path - Current property path for error reporting
   */
  private checkForProblematicValues(
    obj: any,
    result: FrontmatterValidationResult,
    path: string
  ): void {
    if (obj === null || obj === undefined) {
      return;
    }

    if (typeof obj === 'function') {
      result.errors.push(`Functions are not allowed in frontmatter at path: ${path}`);
      result.isValid = false;
      return;
    }

    if (typeof obj === 'symbol') {
      result.errors.push(`Symbols are not allowed in frontmatter at path: ${path}`);
      result.isValid = false;
      return;
    }

    if (obj instanceof Date) {
      // Dates are fine, but warn if they're invalid
      if (isNaN(obj.getTime())) {
        result.warnings.push(`Invalid date at path: ${path}`);
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this.checkForProblematicValues(item, result, `${path}[${index}]`);
      });
      return;
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (typeof key !== 'string') {
          result.errors.push(`Non-string keys are not allowed: ${key}`);
          result.isValid = false;
        }

        this.checkForProblematicValues(value, result, currentPath);
      }
    }
  }

  /**
   * Extracts only the frontmatter from content without parsing content.
   *
   * @param content - Complete file content potentially including frontmatter
   * @returns Frontmatter object (empty object if no frontmatter)
   */
  extractFrontmatter(content: string): Record<string, any> {
    const parsed = this.parse(content);
    return parsed.frontmatter;
  }

  /**
   * Updates frontmatter in content by merging with provided updates.
   *
   * @param content - Complete file content potentially including frontmatter
   * @param updates - Frontmatter properties to merge with existing frontmatter
   * @returns Complete note string with updated frontmatter
   * @throws Error if resulting frontmatter is invalid
   */
  updateFrontmatter(content: string, updates: Record<string, any>): string {
    const parsed = this.parse(content);
    const updatedFrontmatter = { ...parsed.frontmatter, ...updates };

    const validation = this.validate(updatedFrontmatter);
    if (!validation.isValid) {
      throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
    }

    return this.stringify(updatedFrontmatter, parsed.content);
  }
}