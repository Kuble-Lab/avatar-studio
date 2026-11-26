import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { knowledgeSourceHash, listKnowledgePaths } from "../lib/rag-store.js";

const rootDir = process.cwd();
const knowledgeDir = path.resolve(process.env.AVATAR_KNOWLEDGE_DIR || path.join(rootDir, "knowledge"));
const cacheDir = path.resolve(process.env.AVATAR_CACHE_DIR || path.join(rootDir, ".cache"));
const indexPath = path.resolve(process.env.RAG_INDEX_OUTPUT_PATH || path.join(cacheDir, "rag-index.json"));
const manifestPath = path.join(knowledgeDir, "rag-manifest.tsv");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text)
    .split(/\s+/)
    .filter((token) => token.length > 3);
}

function parseManifest() {
  if (!fs.existsSync(manifestPath)) return new Map();
  const rows = read(manifestPath).trim().split(/\r?\n/).slice(1).filter(Boolean);
  return new Map(rows.map((row) => {
    const [file, originalSource, type, priority, notes] = row.split("\t");
    return [file, { originalSource, type, priority, notes }];
  }));
}

function sectionBlocks(text) {
  const headingStack = [];
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      const heading = paragraph.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        headingStack.length = level - 1;
        headingStack[level - 1] = heading[2].trim();
        return [];
      }
      return [{
        sectionPath: headingStack.filter(Boolean).join(" > "),
        text: paragraph
      }];
    });
}

function contextualizeChunk({ title, sectionPath, text }) {
  return [
    `Quelle: ${title}`,
    sectionPath ? `Abschnitt: ${sectionPath}` : "",
    "",
    text
  ].filter(Boolean).join("\n");
}

function chunkText(text, { title, maxChars = 1300, overlap = 220 } = {}) {
  const paragraphs = sectionBlocks(text);
  const chunks = [];
  let current = "";
  let currentSectionPath = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph.text}` : paragraph.text;
    const sectionChanged = currentSectionPath && paragraph.sectionPath !== currentSectionPath && current;
    if (sectionChanged || (next.length > maxChars && current)) {
      chunks.push({
        sectionPath: currentSectionPath,
        text: contextualizeChunk({ title, sectionPath: currentSectionPath, text: current })
      });
      current = sectionChanged ? "" : current.slice(Math.max(0, current.length - overlap));
    }
    currentSectionPath = paragraph.sectionPath || currentSectionPath;
    current = current ? `${current}\n\n${paragraph.text}` : paragraph.text;
  }
  if (current) {
    chunks.push({
      sectionPath: currentSectionPath,
      text: contextualizeChunk({ title, sectionPath: currentSectionPath, text: current })
    });
  }
  return chunks;
}

async function embed(text) {
  if (!openai) return null;
  const response = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: text.slice(0, 8000)
  });
  return response.data[0].embedding;
}

const manifest = parseManifest();
const sourceFiles = listKnowledgePaths(knowledgeDir);

if (!sourceFiles.length) {
  throw new Error(`No indexed knowledge sources found in ${knowledgeDir}`);
}

const chunks = [];

for (const relativeFile of sourceFiles) {
  const absoluteFile = path.join(knowledgeDir, relativeFile);
  const text = read(absoluteFile);
  const manifestEntry = manifest.get(relativeFile) || {};
  const priority = manifestEntry.priority
    || (relativeFile === "default-system-prompt.md" || relativeFile.startsWith("0") ? "high" : "medium");
  const type = manifestEntry.type
    || (relativeFile === "default-system-prompt.md" ? "prompt" : relativeFile.startsWith("0") ? "core" : "rag");
  const title = path.basename(relativeFile).replace(/\.(md|txt)$/i, "");

  chunkText(text, { title }).forEach((chunk, index) => {
    chunks.push({
      id: `${relativeFile}#${index + 1}`,
      source: relativeFile,
      originalSource: manifestEntry.originalSource || relativeFile,
      title,
      section: chunk.sectionPath,
      type,
      priority,
      notes: manifestEntry.notes || "",
      text: chunk.text,
      tokens: tokens(chunk.text)
    });
  });
}

console.log(`Building index with ${chunks.length} chunks`);

for (let index = 0; index < chunks.length; index += 1) {
  if (openai) {
    chunks[index].embedding = await embed(chunks[index].text);
  }
  if ((index + 1) % 25 === 0 || index === chunks.length - 1) {
    console.log(`${index + 1}/${chunks.length}`);
  }
}

fs.mkdirSync(path.dirname(indexPath), { recursive: true });
const temporaryIndexPath = `${indexPath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryIndexPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  embeddingModel: openai ? process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small" : null,
  sourceHash: knowledgeSourceHash(knowledgeDir),
  chunks
}, null, 2));
fs.renameSync(temporaryIndexPath, indexPath);

console.log(`Wrote ${indexPath}`);

