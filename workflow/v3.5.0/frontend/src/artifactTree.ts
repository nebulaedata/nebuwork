import type { Artifact } from "./types";

export type ArtifactFile = {
  key: string;
  type: "file";
  label: string;
  path: string[];
  artifact: Artifact;
};
export type ArtifactFolder = {
  key: string;
  type: "folder";
  label: string;
  path: string[];
  folders: Map<string, ArtifactFolder>;
  files: ArtifactFile[];
  count: number;
};
export type ArtifactEntry = ArtifactFile | ArtifactFolder;

export const folderKey = (path: string[]) => "folder:" + JSON.stringify(path);

function folder(path: string[]): ArtifactFolder {
  return {
    key: folderKey(path),
    type: "folder",
    label: path.at(-1) ?? "全部产物",
    path,
    folders: new Map(),
    files: [],
    count: 0,
  };
}

export function folderEntries(directory: ArtifactFolder): ArtifactEntry[] {
  const compare = (a: ArtifactEntry, b: ArtifactEntry) =>
    a.label.localeCompare(b.label, "zh-CN", { numeric: true });
  return [
    ...[...directory.folders.values()].sort(compare),
    ...[...directory.files].sort(compare),
  ];
}

export function buildArtifactTree(artifacts: Artifact[]) {
  const root = folder([]);
  const entries = new Map<string, ArtifactEntry>([[root.key, root]]);
  for (const artifact of artifacts) {
    const parts = artifact.name.split(/[\\/]/);
    // Names are logical metadata, never paths to traverse on the server. Keep
    // unusual legacy names visible as a single file instead of normalizing them.
    const path = parts.some((part) => !part || part === "." || part === "..")
      ? [artifact.name]
      : parts;
    let current = root;
    current.count++;
    for (let index = 0; index < path.length - 1; index++) {
      const name = path[index];
      let child = current.folders.get(name);
      if (!child) {
        child = folder(path.slice(0, index + 1));
        current.folders.set(name, child);
        entries.set(child.key, child);
      }
      current = child;
      current.count++;
    }
    const file: ArtifactFile = {
      key: "artifact:" + artifact.id,
      type: "file",
      label: path.at(-1)!,
      path: current.path,
      artifact,
    };
    current.files.push(file);
    // Keep every Attempt and scope, even when multiple artifacts share a name.
    entries.set(file.key, file);
  }
  return { root, entries };
}
