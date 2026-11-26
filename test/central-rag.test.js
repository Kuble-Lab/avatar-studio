import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectDir = path.resolve(import.meta.dirname, "..");

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, processHandle) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`server exited early: ${processHandle.output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Retry until the child has bound its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`server did not become ready: ${processHandle.output.join("")}`);
}

async function startServer(env) {
  const port = await availablePort();
  const child = spawn(process.execPath, [path.join(projectDir, "server.js")], {
    cwd: projectDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.output = [];
  child.stdout.on("data", (chunk) => child.output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => child.output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return { child, baseUrl };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("central RAG is administered once and consumed by a remote instance", { timeout: 30000 }, async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-central-rag-"));
  const centralKnowledge = path.join(temporaryRoot, "central-knowledge");
  const centralCache = path.join(temporaryRoot, "central-cache");
  const clientKnowledge = path.join(temporaryRoot, "client-knowledge");
  const clientCache = path.join(temporaryRoot, "client-cache");
  fs.mkdirSync(centralKnowledge, { recursive: true });
  fs.mkdirSync(clientKnowledge, { recursive: true });

  const adminPassword = "test-admin-password";
  const serviceToken = "test-instance-token";
  const central = await startServer({
    ADMIN_PASSWORD: adminPassword,
    ACCESS_CODE: "",
    OPENAI_API_KEY: "",
    AVATAR_KNOWLEDGE_DIR: centralKnowledge,
    AVATAR_CACHE_DIR: centralCache,
    AVATAR_RAG_SERVICE_TOKENS: serviceToken,
    AVATAR_RAG_URL: "",
    AVATAR_RAG_TOKEN: ""
  });
  let client = null;

  try {
    const unauthenticated = await jsonRequest(`${central.baseUrl}/api/internal/rag/status`);
    assert.equal(unauthenticated.response.status, 401);

    const login = await jsonRequest(`${central.baseUrl}/api/admin/login`, {
      method: "POST",
      body: JSON.stringify({ password: adminPassword })
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.csrfToken);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const adminHeaders = { Cookie: cookie, "X-Avatar-CSRF": login.body.csrfToken };

    const profileWrite = await jsonRequest(`${central.baseUrl}/api/admin/settings`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ avatar: {name: "Robin", accent: "#123abc", voice: "cedar", greeting: "Willkommen!"}, systemPrompt: "Konfigurierbare Persönlichkeit." })
    });
    assert.equal(profileWrite.response.status, 200);
    const profile = await jsonRequest(`${central.baseUrl}/api/avatar`);
    assert.equal(profile.body.name, "Robin");
    assert.equal(profile.body.voice, "cedar");
    assert.equal(profile.body.accent, "#123abc");
    assert.equal(JSON.parse(fs.readFileSync(path.join(centralCache, "admin-settings.json"))).avatar.name, "Robin");
    const invalidProfile = await jsonRequest(`${central.baseUrl}/api/admin/settings`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({avatar: {image: "https://example.com/tracker.png"}})
    });
    assert.equal(invalidProfile.response.status, 400);
    assert.equal((await jsonRequest(`${central.baseUrl}/api/avatar`)).body.name, "Robin");
    await jsonRequest(`${central.baseUrl}/api/admin/settings`, {
      method: "PUT", headers: adminHeaders, body: JSON.stringify({systemPrompt: ""})
    });
    const missingKey = await jsonRequest(`${central.baseUrl}/api/avatar/text`, {
      method: "POST", body: JSON.stringify({question: "Hallo"})
    });
    assert.equal(missingKey.response.status, 503);
    for (const file of ["/.env", "/server.js", "/package.json", "/knowledge/test.txt", "/.cache/admin-settings.json", "/api/control/state"]) {
      assert.equal((await fetch(`${central.baseUrl}${file}`)).status, 404);
    }
    for (const page of ["/", "/admin", "/styles.css", "/app.js", "/admin.js"]) {
      assert.equal((await fetch(`${central.baseUrl}${page}`)).status, 200);
    }

    const rejectedWrite = await jsonRequest(`${central.baseUrl}/api/admin/rag/source`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: JSON.stringify({ path: "03-rag-quellen/rejected.txt", content: "should not be written" })
    });
    assert.equal(rejectedWrite.response.status, 403);

    for (const source of [
      { path: "default-system-prompt.md", content: "Du bist das zentrale Test-Avatar." },
      { path: "03-rag-quellen/mond.txt", content: "Die Mondsichel steht im zentralen Wissensraum für einen stillen Neubeginn." }
    ]) {
      const saved = await jsonRequest(`${central.baseUrl}/api/admin/rag/source`, {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify(source)
      });
      assert.equal(saved.response.status, 200);
      assert.equal(saved.body.rag.dirty, true);
    }

    const traversal = await jsonRequest(`${central.baseUrl}/api/admin/rag/source`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ path: "../escape.txt", content: "escape" })
    });
    assert.equal(traversal.response.status, 400);

    const rebuild = await jsonRequest(`${central.baseUrl}/api/admin/rag/rebuild`, {
      method: "POST",
      headers: adminHeaders,
      body: "{}"
    });
    assert.equal(rebuild.response.status, 202);

    let rag = rebuild.body;
    const buildDeadline = Date.now() + 10000;
    while (rag.build.status === "running" && Date.now() < buildDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const status = await jsonRequest(`${central.baseUrl}/api/admin/rag`, { headers: { Cookie: cookie } });
      assert.equal(status.response.status, 200);
      rag = status.body;
    }
    assert.equal(rag.build.status, "succeeded", rag.build.error);
    assert.equal(rag.dirty, false);
    assert.ok(rag.index.chunks >= 2);

    const centralRetrieve = await jsonRequest(`${central.baseUrl}/api/internal/rag/retrieve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ query: "Was bedeutet die Mondsichel?", limit: 3 })
    });
    assert.equal(centralRetrieve.response.status, 200);
    assert.match(centralRetrieve.body.chunks[0].text, /stillen Neubeginn/);
    assert.equal(centralRetrieve.body.systemPrompt, "Du bist das zentrale Test-Avatar.");

    fs.mkdirSync(clientCache, { recursive: true });
    fs.writeFileSync(path.join(clientCache, "rag-index.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      chunks: [{
        id: "local-fallback#1",
        source: "local-fallback.txt",
        title: "local-fallback",
        text: "DIESER VERALTETE LOKALE FALLBACK DARF NIE VERWENDET WERDEN.",
        tokens: ["fallback"]
      }]
    }));

    client = await startServer({
      ADMIN_PASSWORD: "client-admin",
      ACCESS_CODE: "",
      OPENAI_API_KEY: "",
      AVATAR_KNOWLEDGE_DIR: clientKnowledge,
      AVATAR_CACHE_DIR: clientCache,
      AVATAR_RAG_SERVICE_TOKENS: "",
      AVATAR_RAG_URL: central.baseUrl,
      AVATAR_RAG_TOKEN: serviceToken
    });

    const clientHealth = await jsonRequest(`${client.baseUrl}/api/health`);
    assert.equal(clientHealth.body.ragMode, "remote");
    assert.equal(clientHealth.body.remoteRag.available, true);
    assert.equal(clientHealth.body.index.chunks, rag.index.chunks);

    const clientRetrieve = await jsonRequest(`${client.baseUrl}/api/rag`, {
      method: "POST",
      body: JSON.stringify({ query: "Mondsichel", limit: 2 })
    });
    assert.equal(clientRetrieve.response.status, 200);
    assert.match(clientRetrieve.body.chunks[0].text, /zentralen Wissensraum/);
    assert.equal(fs.existsSync(path.join(clientCache, "rag-index.json")), true);
    assert.doesNotMatch(clientRetrieve.body.chunks[0].text, /LOKALE FALLBACK/);

    const promptUpdate = await jsonRequest(`${central.baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ systemPrompt: "Der zentral aktualisierte Prompt ist sofort aktiv." })
    });
    assert.equal(promptUpdate.response.status, 200);

    const clientPrompt = await jsonRequest(`${client.baseUrl}/api/system-prompt`);
    assert.equal(clientPrompt.response.status, 200);
    assert.equal(clientPrompt.body.prompt, "Der zentral aktualisierte Prompt ist sofort aktiv.");
    assert.equal(clientPrompt.body.source, "central-rag");

    const changedSource = await jsonRequest(`${central.baseUrl}/api/admin/rag/source`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        path: "03-rag-quellen/mond.txt",
        content: "Die Mondsichel bedeutet in der zweiten Version ausschliesslich Aufbruch."
      })
    });
    assert.equal(changedSource.response.status, 200);
    assert.ok(changedSource.body.rag.versions.length >= 1);
    const originalVersionId = changedSource.body.rag.versions[0].id;

    const secondRebuild = await jsonRequest(`${central.baseUrl}/api/admin/rag/rebuild`, {
      method: "POST",
      headers: adminHeaders,
      body: "{}"
    });
    assert.equal(secondRebuild.response.status, 202);
    let secondRag = secondRebuild.body;
    while (secondRag.build.status === "running" && Date.now() < buildDeadline + 10000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      secondRag = (await jsonRequest(`${central.baseUrl}/api/admin/rag`, { headers: { Cookie: cookie } })).body;
    }
    assert.equal(secondRag.build.status, "succeeded", secondRag.build.error);

    const changedRetrieve = await jsonRequest(`${client.baseUrl}/api/rag`, {
      method: "POST",
      body: JSON.stringify({ query: "Mondsichel", limit: 2 })
    });
    assert.match(changedRetrieve.body.chunks[0].text, /zweiten Version/);

    const rollback = await jsonRequest(`${central.baseUrl}/api/admin/rag/rollback`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ versionId: originalVersionId })
    });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.rag.dirty, false);

    const restoredRetrieve = await jsonRequest(`${client.baseUrl}/api/rag`, {
      method: "POST",
      body: JSON.stringify({ query: "Mondsichel", limit: 2 })
    });
    assert.match(restoredRetrieve.body.chunks[0].text, /stillen Neubeginn/);

    await stopServer(central.child);
    const unavailableRetrieve = await jsonRequest(`${client.baseUrl}/api/rag`, {
      method: "POST",
      body: JSON.stringify({ query: "fallback", limit: 2 })
    });
    assert.equal(unavailableRetrieve.response.status, 503);
    assert.equal(unavailableRetrieve.body.error, "central_rag_unavailable");
  } finally {
    if (client) await stopServer(client.child);
    await stopServer(central.child);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

