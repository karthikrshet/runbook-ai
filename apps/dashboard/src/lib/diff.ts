export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_FILES = 20;

/**
 * Parses unified diff text, such as `git diff` output recorded from a sandbox
 * command. Text around the diff is ignored; text without a diff gives [].
 * Hunk bodies are read by the line counts in their headers, so a removed line
 * that itself starts with "-- " is never mistaken for a file header.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const startFile = (path: string): FileDiff | null => {
    if (files.length >= MAX_FILES) return null;
    const next: FileDiff = { path, additions: 0, deletions: 0, hunks: [] };
    files.push(next);
    return next;
  };

  for (const line of text.split('\n')) {
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('+') && newLeft > 0) {
        hunk.lines.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ });
        file.additions += 1;
        newLeft -= 1;
        continue;
      }
      if (line.startsWith('-') && oldLeft > 0) {
        hunk.lines.push({ kind: 'remove', text: line.slice(1), oldLine: oldLine++, newLine: null });
        file.deletions += 1;
        oldLeft -= 1;
        continue;
      }
      if ((line.startsWith(' ') || line === '') && oldLeft > 0 && newLeft > 0) {
        hunk.lines.push({
          kind: 'context',
          text: line.slice(1),
          oldLine: oldLine++,
          newLine: newLine++,
        });
        oldLeft -= 1;
        newLeft -= 1;
        continue;
      }
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      // Anything else ends the hunk early; fall through and read it as a header.
      oldLeft = 0;
      newLeft = 0;
    }

    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header?.[2] !== undefined) {
      file = startFile(header[2]);
      hunk = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      // A diff without a "diff --git" line starts at its "---" line.
      if (!file || file.hunks.length > 0) file = startFile(line.slice(4).replace(/^a\//, ''));
      hunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^b\//, '');
      if (file && path !== '/dev/null') file.path = path;
      continue;
    }
    const range = HUNK.exec(line);
    if (range && file) {
      oldLine = Number(range[1]);
      oldLeft = range[2] === undefined ? 1 : Number(range[2]);
      newLine = Number(range[3]);
      newLeft = range[4] === undefined ? 1 : Number(range[4]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    }
  }
  return files.filter((candidate) => candidate.hunks.length > 0);
}
