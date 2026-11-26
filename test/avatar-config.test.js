import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAvatar } from '../lib/avatar-config.js';
test('defaults are usable without a configured avatar', () => {
 const result = normalizeAvatar(null);
 assert.equal(result.name, 'Alex'); assert.equal(result.answerMode, 'avatar'); assert.equal(result.image, '');
});
test('avatar preferences are validated and bounded', () => {
 const result = normalizeAvatar({name:' Robin ',voice:'invalid',accent:'red; background:url(x)',answerMode:'rag_only',description:'x'.repeat(500)});
 assert.equal(result.name,'Robin'); assert.equal(result.voice,'marin'); assert.equal(result.accent,'#5369e8'); assert.equal(result.answerMode,'rag_only'); assert.equal(result.description.length,240);
});
test('avatar portraits cannot use tracking URLs or SVG', () => {
 for (const image of ['https://example.com/track.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=']) assert.throws(()=>normalizeAvatar({image}));
 assert.equal(normalizeAvatar({image:'data:image/png;base64,aGVsbG8='}).image,'data:image/png;base64,aGVsbG8=');
});
