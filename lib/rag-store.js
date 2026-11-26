import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const excludedKnowledgeFiles = new Set([
  "README.md",
  "rag-manifest.tsv"
]);

const maxKnowledgePathLength = 240;
const maxKnowledgeFileBytes = 2 * 1024 * 1024;
const maxArchivedRagVersions = 12;

function walkKnowledgeFiles(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) return [];
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return walkKnowledgeFiles(path.join(directory, entry.name), relativePath);
      }
      if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name)) return [];
      if (excludedKnowledgeFiles.has(relativePath)) return [];
      return [relativePath];
    })
    .sort((left, right) => left.localeCompare(right, "de"));
}

export function listKnowledgePaths(knowledgeDir) {
  return walkKnowledgeFiles(knowledgeDir);
}

export function normalizeKnowledgePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.length > maxKnowledgePathLength || raw.includes("\0")) {
    throw new Error("invalid_knowledge_path");
  }
  if (raw.startsWith("/") || /^[a-z]:\//i.test(raw)) {
    throw new Error("invalid_knowledge_path");
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized === "."
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
    || !/\.(md|txt)$/i.test(normalized)
    || excludedKnowledgeFiles.has(normalized)
  ) {
    throw new Error("invalid_knowledge_path");
  }
  return normalized;
}

export function isProtectedKnowledgePath(relativePath) {
  const normalized = normalizeKnowledgePath(relativePath);
  const basename = path.posix.basename(normalized).toLowerCase();
  return basename === "default-system-prompt.md" || /^0\d[-_.]/.test(basename);
}

function resolveKnowledgePath(knowledgeDir, relativePath) {
  const normalized = normalizeKnowledgePath(relativePath);
  const root = path.resolve(knowledgeDir);
  const absolutePath = path.resolve(root, ...normalized.split("/"));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("invalid_knowledge_path");
  }
  return { normalized, absolutePath };
}

function assertNoSymlinkSegments(knowledgeDir, absolutePath) {
  const root = path.resolve(knowledgeDir);
  const relative = path.relative(root, absolutePath);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("knowledge_symlink_not_allowed");
  }
}

export function readKnowledgeSource(knowledgeDir, relativePath) {
  const { normalized, absolutePath } = resolveKnowledgePath(knowledgeDir, relativePath);
  assertNoSymlinkSegments(knowledgeDir, absolutePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("knowledge_source_not_found");
  }
  return {
    path: normalized,
    content: fs.readFileSync(absolutePath, "utf8"),
    protected: isProtectedKnowledgePath(normalized)
  };
}

export function writeKnowledgeSource(knowledgeDir, relativePath, content) {
  const { normalized, absolutePath } = resolveKnowledgePath(knowledgeDir, relativePath);
  const text = String(content ?? "").replace(/\r\n/g, "\n");
  const size = Buffer.byteLength(text, "utf8");
  if (!text.trim()) throw new Error("knowledge_source_empty");
  if (size > maxKnowledgeFileBytes) throw new Error("knowledge_source_too_large");
  assertNoSymlinkSegments(knowledgeDir, absolutePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporaryPath, text, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, absolutePath);
  return { path: normalized, size, protected: isProtectedKnowledgePath(normalized) };
}

export function deleteKnowledgeSource(knowledgeDir, relativePath) {
  const { normalized, absolutePath } = resolveKnowledgePath(knowledgeDir, relativePath);
  if (isProtectedKnowledgePath(normalized)) throw new Error("knowledge_source_protected");
  assertNoSymlinkSegments(knowledgeDir, absolutePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("knowledge_source_not_found");
  }
  fs.unlinkSync(absolutePath);
  return { path: normalized };
}

export function knowledgeSourceHash(knowledgeDir) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of listKnowledgePaths(knowledgeDir)) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(knowledgeDir, ...relativePath.split("/"))));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function listKnowledgeSources(knowledgeDir, ragIndex = {}) {
  const chunksPerSource = new Map();
  for (const chunk of Array.isArray(ragIndex.chunks) ? ragIndex.chunks : []) {
    chunksPerSource.set(chunk.source, (chunksPerSource.get(chunk.source) || 0) + 1);
  }
  return listKnowledgePaths(knowledgeDir).map((relativePath) => {
    const absolutePath = path.join(knowledgeDir, ...relativePath.split("/"));
    const stats = fs.statSync(absolutePath);
    return {
      path: relativePath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
      chunks: chunksPerSource.get(relativePath) || 0,
      protected: isProtectedKnowledgePath(relativePath)
    };
  });
}

function safeVersionId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._-]{20,80}$/.test(id)) throw new Error("invalid_rag_version");
  return id;
}

function versionDirectory(ragVersionsDir, versionId) {
  const id = safeVersionId(versionId);
  const root = path.resolve(ragVersionsDir);
  const target = path.resolve(root, id);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("invalid_rag_version");
  return { id, target };
}

export function archiveRagState({ knowledgeDir, indexPath, ragVersionsDir, reason = "snapshot" }) {
  if (!fs.existsSync(indexPath)) return null;
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomUUID().slice(0, 8)}`;
  const { target } = versionDirectory(ragVersionsDir, id);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(temporary, { recursive: true });
  fs.copyFileSync(indexPath, path.join(temporary, "rag-index.json"));
  if (fs.existsSync(knowledgeDir)) {
    fs.cpSync(knowledgeDir, path.join(temporary, "knowledge"), {
      recursive: true,
      filter: (source) => !fs.lstatSync(source).isSymbolicLink()
    });
  } else {
    fs.mkdirSync(path.join(temporary, "knowledge"), { recursive: true });
  }
  const metadata = {
    id,
    reason: String(reason || "snapshot").slice(0, 120),
    archivedAt: new Date().toISOString(),
    generatedAt: index.generatedAt || null,
    sourceHash: index.sourceHash || null,
    chunks: Array.isArray(index.chunks) ? index.chunks.length : 0,
    sources: listKnowledgePaths(knowledgeDir).length
  };
  fs.writeFileSync(path.join(temporary, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  fs.mkdirSync(ragVersionsDir, { recursive: true });
  fs.renameSync(temporary, target);
  for (const version of listRagVersions(ragVersionsDir).slice(maxArchivedRagVersions)) {
    const { target: expiredTarget } = versionDirectory(ragVersionsDir, version.id);
    fs.rmSync(expiredTarget, { recursive: true, force: true });
  }
  return metadata;
}

export function listRagVersions(ragVersionsDir) {
  if (!fs.existsSync(ragVersionsDir)) return [];
  return fs.readdirSync(ragVersionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".tmp"))
    .map((entry) => {
      try {
        const { target } = versionDirectory(ragVersionsDir, entry.name);
        return JSON.parse(fs.readFileSync(path.join(target, "metadata.json"), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.archivedAt).localeCompare(String(left.archivedAt)));
}

export function restoreRagState({ knowledgeDir, indexPath, ragVersionsDir, versionId }) {
  const { id, target } = versionDirectory(ragVersionsDir, versionId);
  const archivedIndexPath = path.join(target, "rag-index.json");
  const archivedKnowledgeDir = path.join(target, "knowledge");
  if (!fs.existsSync(archivedIndexPath) || !fs.existsSync(archivedKnowledgeDir)) {
    throw new Error("rag_version_incomplete");
  }
  const index = JSON.parse(fs.readFileSync(archivedIndexPath, "utf8"));
  if (!Array.isArray(index.chunks) || !index.chunks.length) throw new Error("rag_version_invalid");

  const restoreId = crypto.randomUUID();
  const stagedKnowledge = `${knowledgeDir}.restore-${restoreId}`;
  const previousKnowledge = `${knowledgeDir}.previous-${restoreId}`;
  const stagedIndex = `${indexPath}.restore-${restoreId}`;
  fs.cpSync(archivedKnowledgeDir, stagedKnowledge, { recursive: true });
  fs.copyFileSync(archivedIndexPath, stagedIndex);

  let movedPreviousKnowledge = false;
  try {
    if (fs.existsSync(knowledgeDir)) {
      fs.renameSync(knowledgeDir, previousKnowledge);
      movedPreviousKnowledge = true;
    }
    fs.renameSync(stagedKnowledge, knowledgeDir);
    fs.renameSync(stagedIndex, indexPath);
    if (movedPreviousKnowledge) fs.rmSync(previousKnowledge, { recursive: true, force: true });
    return { id, index };
  } catch (error) {
    if (!fs.existsSync(knowledgeDir) && movedPreviousKnowledge && fs.existsSync(previousKnowledge)) {
      fs.renameSync(previousKnowledge, knowledgeDir);
    }
    if (fs.existsSync(stagedKnowledge)) fs.rmSync(stagedKnowledge, { recursive: true, force: true });
    if (fs.existsSync(stagedIndex)) fs.rmSync(stagedIndex, { force: true });
    throw error;
  }
}

