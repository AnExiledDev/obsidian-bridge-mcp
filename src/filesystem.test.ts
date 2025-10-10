import { test, expect, beforeEach, afterEach } from "vitest";
import { FileSystemService } from "./filesystem.js";
import { writeFile, mkdir, rmdir } from "fs/promises";
import { join } from "path";

const testVaultPath = "/tmp/test-vault-filesystem";
let fileSystem: FileSystemService;

beforeEach(async () => {
  await mkdir(testVaultPath, { recursive: true });
  fileSystem = new FileSystemService(testVaultPath);
});

afterEach(async () => {
  try {
    await rmdir(testVaultPath, { recursive: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});

// ============================================================================
// PATCH TESTS
// ============================================================================

test("patch note with single occurrence", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nThis is the old content.\n\nMore text here.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "old content",
    newString: "new content",
    replaceAll: false
  });

  expect(result.success).toBe(true);
  expect(result.matchCount).toBe(1);
  expect(result.message).toContain("Successfully replaced 1 occurrence");

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("new content");
  expect(updatedNote.content).not.toContain("old content");
});

test("patch note with multiple occurrences requires replaceAll", async () => {
  const testPath = "test-note.md";
  const content = "# Test\n\nrepeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "repeat",
    newString: "unique",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.matchCount).toBe(3);
  expect(result.message).toContain("Found 3 occurrences");
  expect(result.message).toContain("Use replaceAll=true");
});

test("patch note with replaceAll replaces all occurrences", async () => {
  const testPath = "test-note.md";
  const content = "# Test\n\nrepeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "repeat",
    newString: "unique",
    replaceAll: true
  });

  expect(result.success).toBe(true);
  expect(result.matchCount).toBe(3);
  expect(result.message).toContain("Successfully replaced 3 occurrences");

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).not.toContain("repeat");
  expect(updatedNote.content.match(/unique/g)?.length).toBe(3);
});

test("patch note fails when string not found", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nSome content here.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "non-existent string",
    newString: "replacement",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.matchCount).toBe(0);
  expect(result.message).toContain("String not found");
});

test("patch note with multiline replacement", async () => {
  const testPath = "test-note.md";
  const content = "# Test\n\n## Section A\nOld content\nOld lines\n\n## Section B\nOther content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "## Section A\nOld content\nOld lines",
    newString: "## Section A\nNew content\nNew improved lines",
    replaceAll: false
  });

  expect(result.success).toBe(true);
  expect(result.matchCount).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("New content");
  expect(updatedNote.content).toContain("New improved lines");
  expect(updatedNote.content).not.toContain("Old content");
});

test("patch note with frontmatter preserved", async () => {
  const testPath = "test-note.md";
  const content = `---
title: My Note
tags: [test]
---

# Content

Old text here.`;

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "Old text here.",
    newString: "New text here.",
    replaceAll: false
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.frontmatter.title).toBe("My Note");
  expect(updatedNote.frontmatter.tags).toEqual(["test"]);
  expect(updatedNote.content).toContain("New text here.");
});

test("patch note fails when oldString equals newString", async () => {
  const testPath = "test-note.md";
  const content = "# Test\n\nSome content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "same",
    newString: "same",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("must be different");
});

test("patch note fails for filtered paths", async () => {
  const testPath = ".obsidian/config.json";

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "old",
    newString: "new",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("is denied");
});

test("patch note fails when file doesn't exist", async () => {
  const testPath = "non-existent-note.md";

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "old",
    newString: "new",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("File not found");
});

test("patch note fails with empty oldString", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nSome content.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "",
    newString: "new",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.message).toMatch(/empty|filled|required/i);
});

test("patch note fails with empty newString", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nSome content.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "content",
    newString: "",
    replaceAll: false
  });

  expect(result.success).toBe(false);
  expect(result.message).toMatch(/empty|filled|required/i);
});

test("patch note handles regex special characters literally", async () => {
  const testPath = "test-note.md";
  const content = "Price: $10.50 (special)";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "$10.50",
    newString: "$15.75",
    replaceAll: false
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("$15.75");
  expect(updatedNote.content).not.toContain("$10.50");
});

test("patch note preserves tabs and spaces", async () => {
  const testPath = "test-note.md";
  const content = "Line with\ttabs\n  Line with spaces\n\tTabbed line";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "tabs",
    newString: "TABS",
    replaceAll: false
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("Line with\tTABS");
  expect(updatedNote.content).toContain("\tTabbed line");
  expect(updatedNote.content).toContain("  Line with spaces");
});

test("patch note is case sensitive", async () => {
  const testPath = "test-note.md";
  const content = "Hello world, hello again";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "hello",
    newString: "hi",
    replaceAll: false
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("Hello world");
  expect(updatedNote.content).toContain("hi again");
});

test("patch note handles many replacements efficiently", async () => {
  const testPath = "test-note.md";
  const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: replace_me`);
  const content = lines.join("\n");

  await writeFile(join(testVaultPath, testPath), content);

  const startTime = Date.now();
  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "replace_me",
    newString: "replaced",
    replaceAll: true
  });
  const duration = Date.now() - startTime;

  expect(result.success).toBe(true);
  expect(result.matchCount).toBe(100);
  expect(duration).toBeLessThan(1000);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).not.toContain("replace_me");
  expect(updatedNote.content.match(/replaced/g)?.length).toBe(100);
});

test("patch note works with path containing spaces", async () => {
  const testPath = "folder name/note with spaces.md";
  const content = "# Test Note\n\nOld content here.";

  await mkdir(join(testVaultPath, "folder name"), { recursive: true });
  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.patchNote({
    path: testPath,
    oldString: "Old content",
    newString: "New content",
    replaceAll: false
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("New content");
});

// ============================================================================
// DELETE TESTS
// ============================================================================

test("delete note with correct confirmation", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nThis is a test note to be deleted.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: testPath
  });

  expect(result.success).toBe(true);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("Successfully deleted");
  expect(result.message).toContain("cannot be undone");
});

test("reject deletion with incorrect confirmation", async () => {
  const testPath = "test-note.md";
  const content = "# Test Note\n\nThis note should not be deleted.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: "wrong-path.md"
  });

  expect(result.success).toBe(false);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("confirmation path does not match");

  const fileStillExists = await fileSystem.exists(testPath);
  expect(fileStillExists).toBe(true);
});

test("handle deletion of non-existent file", async () => {
  const testPath = "non-existent.md";

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: testPath
  });

  expect(result.success).toBe(false);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("File not found");
});

test("reject deletion of filtered paths", async () => {
  const testPath = ".obsidian/app.json";

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: testPath
  });

  expect(result.success).toBe(false);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("Access denied");
});

test("handle directory deletion attempt", async () => {
  const testPath = "test-directory";

  await mkdir(join(testVaultPath, testPath));

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: testPath
  });

  expect(result.success).toBe(false);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("is not a file");
});

test("delete note with frontmatter", async () => {
  const testPath = "note-with-frontmatter.md";
  const content = `---
title: Test Note
tags: [test, delete]
---

# Test Note

This note has frontmatter and should be deleted successfully.`;

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.deleteNote({
    path: testPath,
    confirmPath: testPath
  });

  expect(result.success).toBe(true);
  expect(result.path).toBe(testPath);
  expect(result.message).toContain("Successfully deleted");
});

// ============================================================================
// FRONTMATTER INTEGRATION TESTS
// ============================================================================

test("write_note with frontmatter", async () => {
  await fileSystem.writeNote({
    path: "test.md",
    content: "This is test content.",
    frontmatter: {
      title: "Test Note",
      tags: ["test", "example"],
      created: "2023-01-01"
    }
  });

  const note = await fileSystem.readNote("test.md");

  expect(note.frontmatter.title).toBe("Test Note");
  expect(note.frontmatter.tags).toEqual(["test", "example"]);
  expect(note.frontmatter.created).toBe("2023-01-01");
  expect(note.content.trim()).toBe("This is test content.");
});

test("write_note with append mode preserves frontmatter", async () => {
  await fileSystem.writeNote({
    path: "append-test.md",
    content: "Original content.",
    frontmatter: { title: "Original", status: "draft" }
  });

  await fileSystem.writeNote({
    path: "append-test.md",
    content: "\nAppended content.",
    frontmatter: { updated: "2023-12-01" },
    mode: "append"
  });

  const note = await fileSystem.readNote("append-test.md");

  expect(note.frontmatter.title).toBe("Original");
  expect(note.frontmatter.status).toBe("draft");
  expect(note.frontmatter.updated).toBe("2023-12-01");
  expect(note.content.trim()).toBe("Original content.\n\nAppended content.");
});

test("update_frontmatter merges with existing", async () => {
  await fileSystem.writeNote({
    path: "update-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Original Title",
      tags: ["original"],
      status: "draft"
    }
  });

  await fileSystem.updateFrontmatter({
    path: "update-test.md",
    frontmatter: {
      title: "Updated Title",
      priority: "high"
    },
    merge: true
  });

  const note = await fileSystem.readNote("update-test.md");

  expect(note.frontmatter.title).toBe("Updated Title");
  expect(note.frontmatter.tags).toEqual(["original"]);
  expect(note.frontmatter.status).toBe("draft");
  expect(note.frontmatter.priority).toBe("high");
  expect(note.content.trim()).toBe("Test content.");
});

test("update_frontmatter replaces when merge is false", async () => {
  await fileSystem.writeNote({
    path: "replace-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Original Title",
      tags: ["original"],
      status: "draft"
    }
  });

  await fileSystem.updateFrontmatter({
    path: "replace-test.md",
    frontmatter: {
      title: "New Title",
      priority: "high"
    },
    merge: false
  });

  const note = await fileSystem.readNote("replace-test.md");

  expect(note.frontmatter.title).toBe("New Title");
  expect(note.frontmatter.priority).toBe("high");
  expect(note.frontmatter.tags).toBeUndefined();
  expect(note.frontmatter.status).toBeUndefined();
});

test("manage_tags add operation", async () => {
  await fileSystem.writeNote({
    path: "tags-add-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Test",
      tags: ["existing"]
    }
  });

  const result = await fileSystem.manageTags({
    path: "tags-add-test.md",
    operation: "add",
    tags: ["new", "important"]
  });

  expect(result.success).toBe(true);
  expect(result.tags).toEqual(["existing", "new", "important"]);

  const note = await fileSystem.readNote("tags-add-test.md");
  expect(note.frontmatter.tags).toEqual(["existing", "new", "important"]);
});

test("manage_tags remove operation", async () => {
  await fileSystem.writeNote({
    path: "tags-remove-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Test",
      tags: ["keep", "remove1", "remove2"]
    }
  });

  const result = await fileSystem.manageTags({
    path: "tags-remove-test.md",
    operation: "remove",
    tags: ["remove1", "remove2"]
  });

  expect(result.success).toBe(true);
  expect(result.tags).toEqual(["keep"]);

  const note = await fileSystem.readNote("tags-remove-test.md");
  expect(note.frontmatter.tags).toEqual(["keep"]);
});

test("manage_tags list operation", async () => {
  await fileSystem.writeNote({
    path: "tags-list-test.md",
    content: "Test content with #inline-tag.",
    frontmatter: {
      title: "Test",
      tags: ["frontmatter-tag"]
    }
  });

  const result = await fileSystem.manageTags({
    path: "tags-list-test.md",
    operation: "list"
  });

  expect(result.success).toBe(true);
  expect(result.tags).toContain("frontmatter-tag");
  expect(result.tags).toContain("inline-tag");
});

test("manage_tags removes tags array when empty", async () => {
  await fileSystem.writeNote({
    path: "tags-empty-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Test",
      tags: ["remove-me"]
    }
  });

  await fileSystem.manageTags({
    path: "tags-empty-test.md",
    operation: "remove",
    tags: ["remove-me"]
  });

  const note = await fileSystem.readNote("tags-empty-test.md");
  expect(note.frontmatter.tags).toBeUndefined();
  expect(note.frontmatter.title).toBe("Test");
});

test("frontmatter validation with invalid data", async () => {
  await expect(fileSystem.writeNote({
    path: "invalid-test.md",
    content: "Test content.",
    frontmatter: {
      title: "Test",
      invalidFunction: () => "not allowed"
    }
  })).rejects.toThrow(/Invalid frontmatter/);
});

test("edit_note with single edit", async () => {
  const testPath = "edit-test.md";
  const content = "# Test Note\n\nThis is old content.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "old content", replace: "new content" }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);
  expect(result.deletionsApplied).toBe(0);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("new content");
  expect(updatedNote.content).not.toContain("old content");
});

test("edit_note with single deletion", async () => {
  const testPath = "edit-test.md";
  const content = "# Test Note\n\nThis is REMOVE_ME content.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{ match: "REMOVE_ME " }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(0);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("This is content.");
  expect(updatedNote.content).not.toContain("REMOVE_ME");
});

test("edit_note with multiple non-conflicting edits", async () => {
  const testPath = "edit-test.md";
  const content = "Line 1: old\nLine 5: different\nLine 10: another";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [
      { match: "old", replace: "NEW" },
      { match: "different", replace: "CHANGED" },
      { match: "another", replace: "UPDATED" }
    ]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("NEW");
  expect(updatedNote.content).toContain("CHANGED");
  expect(updatedNote.content).toContain("UPDATED");
});

test("edit_note detects edit-edit conflicts", async () => {
  const testPath = "edit-test.md";
  const content = "This is some overlapping text here.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [
      { match: "overlapping text", replace: "NEW" },
      { match: "text here", replace: "CONFLICT" }
    ]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("overlapping");
  expect(result.message).toContain("Solution:");
});

test("edit_note detects edit-deletion conflicts", async () => {
  const testPath = "edit-test.md";
  const content = "This is some text to modify.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "text to", replace: "EDITED" }],
    deletions: [{ match: "to modify" }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("overlapping");
  expect(result.message).toContain("Solution:");
});

test("edit_note applies bottom-up order correctly", async () => {
  const testPath = "edit-test.md";
  const content = "Line 1: first\nLine 2: second\nLine 3: third";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [
      { match: "first", replace: "1ST" },
      { match: "second", replace: "2ND" },
      { match: "third", replace: "3RD" }
    ]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1: 1ST\nLine 2: 2ND\nLine 3: 3RD");
});

test("edit_note preserves frontmatter", async () => {
  const testPath = "edit-test.md";
  const content = `---
title: Test Note
tags: [test]
---

# Content

Old text here.`;

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "Old text", replace: "New text" }]
  });

  expect(result.success).toBe(true);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.frontmatter.title).toBe("Test Note");
  expect(updatedNote.frontmatter.tags).toEqual(["test"]);
  expect(updatedNote.content).toContain("New text");
});

test("edit_note with occurrence parameter 'all'", async () => {
  const testPath = "edit-test.md";
  const content = "repeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "repeat", replace: "REPLACED", occurrence: "all" }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("REPLACED word REPLACED word REPLACED");
});

test("edit_note with occurrence parameter 'first'", async () => {
  const testPath = "edit-test.md";
  const content = "repeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "repeat", replace: "FIRST", occurrence: "first" }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("FIRST word repeat word repeat");
});

test("edit_note with occurrence parameter 'last'", async () => {
  const testPath = "edit-test.md";
  const content = "repeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "repeat", replace: "LAST", occurrence: "last" }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("repeat word repeat word LAST");
});

test("edit_note with occurrence parameter as number", async () => {
  const testPath = "edit-test.md";
  const content = "repeat word repeat word repeat";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "repeat", replace: "SECOND", occurrence: 2 }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("repeat word SECOND word repeat");
});

test("edit_note fails with invalid regex pattern", async () => {
  const testPath = "edit-test.md";
  const content = "Test content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "[invalid(regex", replace: "test", regex: true } as any]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("invalid regular expression");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("regex");
});

test("edit_note fails with empty replace string", async () => {
  const testPath = "edit-test.md";
  const content = "Test content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "content", replace: "" }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("empty string as a replacement");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("deletions");
});

test("edit_note fails with too many edits", async () => {
  const testPath = "edit-test.md";
  const content = "Test content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: Array.from({ length: 15 }, (_, i) => ({ match: `text${i}`, replace: "new" }))
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("15 edits");
  expect(result.message).toContain("maximum is 10");
  expect(result.message).toContain("Solution:");
});

test("edit_note atomic rollback on conflict", async () => {
  const testPath = "edit-test.md";
  const content = "Original overlapping content.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [
      { match: "overlapping content", replace: "NEW" },
      { match: "content", replace: "CONFLICT" }
    ]
  });

  expect(result.success).toBe(false);

  // Verify file is unchanged
  const unchangedNote = await fileSystem.readNote(testPath);
  expect(unchangedNote.content).toBe("Original overlapping content.");
});

test("edit_note combined edits and deletions", async () => {
  const testPath = "edit-test.md";
  const content = "Keep this. Replace this. Delete this.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "Replace this", replace: "REPLACED" }],
    deletions: [{ match: " Delete this." }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Keep this. REPLACED.");
});

test("edit_note with anchor-based edit (offset 0)", async () => {
  const testPath = "anchor-test.md";
  const content = "# Meeting Notes\n\n## Action Items\n- Old action item\n- Another item";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Action Items", offset: 0 },
      replace: "## Updated Action Items"
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("## Updated Action Items");
  expect(updatedNote.content).not.toContain("## Action Items\n");
});

test("edit_note with anchor-based edit (offset 1)", async () => {
  const testPath = "anchor-test.md";
  const content = "# Meeting Notes\n\n## Action Items\n- Old action item\n- Another item";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Action Items", offset: 1 },
      replace: "- New action item added"
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("- New action item added");
  expect(updatedNote.content).not.toContain("- Old action item");
});

test("edit_note with anchor-based deletion", async () => {
  const testPath = "anchor-test.md";
  const content = "# Meeting Notes\n\n## Action Items\n- Remove this item\n- Keep this item";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{
      anchor: { after: "## Action Items", offset: 1 }
    }]
  });

  expect(result.success).toBe(true);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).not.toContain("- Remove this item");
  expect(updatedNote.content).toContain("- Keep this item");
});

test("edit_note anchor with anchorOccurrence 'first'", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nFirst content\n\n## Section\nSecond content\n\n## Section\nThird content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 1 },
      replace: "Modified first section",
      anchorOccurrence: "first"
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("Modified first section");
  expect(updatedNote.content).toContain("Second content");
  expect(updatedNote.content).toContain("Third content");
});

test("edit_note anchor with anchorOccurrence 'last'", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nFirst content\n\n## Section\nSecond content\n\n## Section\nThird content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 1 },
      replace: "Modified last section",
      anchorOccurrence: "last"
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("First content");
  expect(updatedNote.content).toContain("Second content");
  expect(updatedNote.content).toContain("Modified last section");
});

test("edit_note anchor with anchorOccurrence as number", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nFirst content\n\n## Section\nSecond content\n\n## Section\nThird content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 1 },
      replace: "Modified second section",
      anchorOccurrence: 2
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("First content");
  expect(updatedNote.content).toContain("Modified second section");
  expect(updatedNote.content).toContain("Third content");
});

test("edit_note anchor fails when anchor text not found", async () => {
  const testPath = "anchor-test.md";
  const content = "# Meeting Notes\n\nSome content here.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Nonexistent Section", offset: 1 },
      replace: "New content"
    }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("Could not find anchor text");
  expect(result.message).toContain("## Nonexistent Section");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("read_note");
});

test("edit_note anchor fails with multiple matches and no anchorOccurrence", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nFirst\n\n## Section\nSecond\n\n## Section\nThird";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 1 },
      replace: "Modified"
    }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("Found 3 occurrences of anchor text");
  expect(result.message).toContain("cannot safely apply");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("anchorOccurrence: 1");
  expect(result.message).toContain("anchorOccurrence: last");
});

test("edit_note anchor fails when offset points to invalid line", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nOnly one line after";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 10 },
      replace: "New content"
    }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("anchor points to line");
  expect(result.message).toContain("only has");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("Adjust the offset");
});

test("edit_note anchor with invalid anchorOccurrence number", async () => {
  const testPath = "anchor-test.md";
  const content = "## Section\nFirst\n\n## Section\nSecond";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "## Section", offset: 1 },
      replace: "Modified",
      anchorOccurrence: 5
    }]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("Requested anchor occurrence #5");
  expect(result.message).toContain("only found 2");
  expect(result.message).toContain("Solution:");
});

test("edit_note anchor-based deletion with anchorOccurrence", async () => {
  const testPath = "anchor-test.md";
  const content = "## Task 1\n- Item A\n\n## Task 2\n- Item B\n\n## Task 3\n- Item C";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{
      anchor: { after: "## Task", offset: 1 },
      anchorOccurrence: 2
    }]
  });

  expect(result.success).toBe(true);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("- Item A");
  expect(updatedNote.content).not.toContain("- Item B");
  expect(updatedNote.content).toContain("- Item C");
});

test("edit_note anchor works with offset 0 (same line)", async () => {
  const testPath = "anchor-test.md";
  const content = "Line 1\nLine 2: OLD\nLine 3";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{
      anchor: { after: "Line 2: OLD", offset: 0 },
      replace: "Line 2: NEW"
    }]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1\nLine 2: NEW\nLine 3");
});

test("edit_note anchor combined with other edits", async () => {
  const testPath = "anchor-test.md";
  const content = "# Title\n\nSection A: old\n\n## Marker\nSection B: old";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [
      { match: "Section A: old", replace: "Section A: new" },
      {
        anchor: { after: "## Marker", offset: 1 },
        replace: "Section B: new"
      }
    ]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(2);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toContain("Section A: new");
  expect(updatedNote.content).toContain("Section B: new");
});

test("edit_note with basic regex without capture groups", async () => {
  const testPath = "regex-test.md";
  const content = "This has old and old words in it.";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "\\bold\\b", replace: "new", flags: "g" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(2);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("This has new and new words in it.");
});

test("edit_note with regex and case insensitive flag", async () => {
  const testPath = "regex-test.md";
  const content = "OLD text and Old text and old text";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "OLD", replace: "new", flags: "gi" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("new text and new text and new text");
});

test("edit_note with regex pattern not found error", async () => {
  const testPath = "regex-test.md";
  const content = "This is some content";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "nonexistent\\w+", replace: "new", flags: "" } as any]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("regex pattern");
  expect(result.message).toContain("did not match");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("read_note");
});

test("edit_note with single capture group", async () => {
  const testPath = "regex-test.md";
  const content = "function getName() { return 'test'; }";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "function (\\w+)", replace: "const $1 =", flags: "" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("const getName =() { return 'test'; }");
});

test("edit_note with multiple capture groups for date conversion", async () => {
  const testPath = "regex-test.md";
  const content = "Date: 2023-12-25";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "(\\d{4})-(\\d{2})-(\\d{2})", replace: "$2/$3/$1", flags: "" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Date: 12/25/2023");
});

test("edit_note with capture group and global flag", async () => {
  const testPath = "regex-test.md";
  const content = "[foo] and [bar] and [baz]";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "\\[(\\w+)\\]", replace: "($1)", flags: "g" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("(foo) and (bar) and (baz)");
});

test("edit_note with nested capture groups", async () => {
  const testPath = "regex-test.md";
  const content = "name:John age:30";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "((\\w+):(\\w+))", replace: "$2=$3", flags: "g" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(2);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("name=John age=30");
});

test("edit_note with escaped dollar sign in replacement", async () => {
  const testPath = "regex-test.md";
  const content = "The price is 50";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "price", replace: "cost $100", flags: "" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("The cost $100 is 50");
});

test("edit_note with multiline flag", async () => {
  const testPath = "regex-test.md";
  const content = "start\nmiddle text\nend";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "start.*end", replace: "REPLACED", flags: "s" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("REPLACED");
});

test("edit_note with zero-width match prevention", async () => {
  const testPath = "regex-test.md";
  const content = "Line 1\nLine 2\nLine 3";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ pattern: "^", replace: "> ", flags: "gm" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(3);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("> Line 1\n> Line 2\n> Line 3");
});

test("edit_note replace specific line number", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ line: 3, replace: "New line 3 content" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1\nLine 2\nNew line 3 content\nLine 4\nLine 5");
});

test("edit_note replace first line", async () => {
  const testPath = "line-test.md";
  const content = "First line\nSecond line\nThird line";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ line: 1, replace: "New first line" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("New first line\nSecond line\nThird line");
});

test("edit_note replace last line", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ line: 3, replace: "New last line" } as any]
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1\nLine 2\nNew last line");
});

test("edit_note fails with invalid line number out of range", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ line: 999, replace: "Error" } as any]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("line 999");
  expect(result.message).toContain("only has 3 lines");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("valid line number");
  expect(result.message).toContain("between 1 and 3");
});

test("edit_note delete single line", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{ line: 3 } as any]
  });

  expect(result.success).toBe(true);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1\nLine 2\nLine 4\nLine 5");
});

test("edit_note delete line range", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{ startLine: 2, endLine: 4 } as any]
  });

  expect(result.success).toBe(true);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("Line 1\nLine 5");
});

test("edit_note fails with invalid line range startLine greater than endLine", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{ startLine: 5, endLine: 2 } as any]
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("startLine (5) greater than endLine (2)");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("less than or equal to endLine");
});

test("edit_note line range deletion handles newlines correctly", async () => {
  const testPath = "line-test.md";
  const content = "Line 1\nLine 2\nLine 3\nLine 4";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    deletions: [{ startLine: 2, endLine: 3 } as any]
  });

  expect(result.success).toBe(true);
  expect(result.deletionsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // Should have Line 1 and Line 4, with no extra newlines
  expect(updatedNote.content).toBe("Line 1\nLine 4");
  // Verify no double newlines
  expect(updatedNote.content).not.toContain("\n\n");
});

test("edit_note with editFrontmatter true edits frontmatter only preserves content", async () => {
  const testPath = "frontmatter-test.md";
  const noteContent = `---
title: Original Title
status: draft
tags: [test]
---

# Content

This is the content that should not change.`;

  await writeFile(join(testVaultPath, testPath), noteContent);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "status: draft", replace: "status: published" }],
    options: { editFrontmatter: true }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // Frontmatter should be changed
  expect(updatedNote.frontmatter.status).toBe("published");
  expect(updatedNote.frontmatter.title).toBe("Original Title");
  expect(updatedNote.frontmatter.tags).toEqual(["test"]);
  // Content should be unchanged (with trailing newline from frontmatter processing)
  expect(updatedNote.content.trim()).toBe("# Content\n\nThis is the content that should not change.");
});

test("edit_note with editFrontmatter false edits content only preserves frontmatter", async () => {
  const testPath = "frontmatter-test.md";
  const noteContent = `---
title: Test Note
status: draft
---

# Content

This is old text that will change.`;

  await writeFile(join(testVaultPath, testPath), noteContent);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "old text", replace: "new text" }],
    options: { editFrontmatter: false }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // Content should be changed
  expect(updatedNote.content).toContain("new text");
  expect(updatedNote.content).not.toContain("old text");
  // Frontmatter should be unchanged
  expect(updatedNote.frontmatter.title).toBe("Test Note");
  expect(updatedNote.frontmatter.status).toBe("draft");
});

test("edit_note with editFrontmatter true only edits frontmatter when string in both", async () => {
  const testPath = "frontmatter-test.md";
  const noteContent = `---
title: Test
author: Test Author
---

# Test Content

This is a test of the content.`;

  await writeFile(join(testVaultPath, testPath), noteContent);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "Test", replace: "MODIFIED", occurrence: "all" }],
    options: { editFrontmatter: true }
  });

  expect(result.success).toBe(true);
  // Should match "Test" in title and "Test Author" (2 matches in frontmatter)
  expect(result.editsApplied).toBe(2);

  const updatedNote = await fileSystem.readNote(testPath);
  // Frontmatter should be changed
  expect(updatedNote.frontmatter.title).toBe("MODIFIED");
  expect(updatedNote.frontmatter.author).toBe("MODIFIED Author");
  // Content should be unchanged (still has "Test" in it)
  expect(updatedNote.content).toContain("Test Content");
  expect(updatedNote.content).toContain("test of the content");
});

test("edit_note with editFrontmatter true fails when frontmatter does not exist", async () => {
  const testPath = "frontmatter-test.md";
  const noteContent = "# No Frontmatter\n\nJust plain content here.";

  await writeFile(join(testVaultPath, testPath), noteContent);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "anything", replace: "new" }],
    options: { editFrontmatter: true }
  });

  expect(result.success).toBe(false);
  expect(result.message).toContain("Could not find the text 'anything'");
  expect(result.message).toContain("frontmatter");
  expect(result.message).toContain("Solution:");
  expect(result.message).toContain("read_note");
});

test("edit_note preserveIndentation with 4-space indentation", async () => {
  const testPath = "indent-test.md";
  const content = "function test() {\n    old code\n        nested line\n}";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "    old code\n        nested line", replace: "new code\nnested" }],
    options: { preserveIndentation: true }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("function test() {\n    new code\n    nested\n}");
});

test("edit_note preserveIndentation with tab indentation", async () => {
  const testPath = "indent-test.md";
  const content = "function test() {\n\told code\n\t\tnested line\n}";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "\told code\n\t\tnested line", replace: "new code\nnested" }],
    options: { preserveIndentation: true }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  expect(updatedNote.content).toBe("function test() {\n\tnew code\n\tnested\n}");
});

test("edit_note preserveIndentation with no indentation to preserve", async () => {
  const testPath = "indent-test.md";
  const content = "old code\nmore lines";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "old code", replace: "new code\nmore lines" }],
    options: { preserveIndentation: true }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // No leading whitespace, so no indentation should be added
  expect(updatedNote.content).toBe("new code\nmore lines\nmore lines");
});

test("edit_note preserveIndentation with empty lines in replacement", async () => {
  const testPath = "indent-test.md";
  const content = "function test() {\n    old\n}";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "    old", replace: "new\n\nmore" }],
    options: { preserveIndentation: true }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // Empty line should remain empty (no indentation added to empty lines)
  expect(updatedNote.content).toBe("function test() {\n    new\n\n    more\n}");
});

test("edit_note preserveIndentation false does not add indentation", async () => {
  const testPath = "indent-test.md";
  const content = "function test() {\n    old code\n}";

  await writeFile(join(testVaultPath, testPath), content);

  const result = await fileSystem.editNote({
    path: testPath,
    edits: [{ match: "    old code", replace: "new code" }],
    options: { preserveIndentation: false }
  });

  expect(result.success).toBe(true);
  expect(result.editsApplied).toBe(1);

  const updatedNote = await fileSystem.readNote(testPath);
  // No indentation should be added when preserveIndentation is false
  expect(updatedNote.content).toBe("function test() {\nnew code\n}");
});
