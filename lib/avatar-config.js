export const voices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const text = (value, fallback, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : fallback;
export function normalizeAvatar(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const image = text(value.image, '', 1500000);
  // Embedded raster images only: no remote tracking URLs or executable SVG.
  if (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('invalid_avatar_image');
  return {
    name: text(value.name, 'Alex', 80) || 'Alex',
    description: text(value.description, 'Dein persönlicher KI-Avatar', 240),
    greeting: text(value.greeting, 'Hallo! Wobei kann ich dir helfen?', 500),
    image,
    accent: /^#[a-fA-F0-9]{6}$/.test(value.accent || '') ? value.accent : '#5369e8',
    voice: voices.includes(value.voice) ? value.voice : 'marin',
    voiceStyle: text(value.voiceStyle, 'Natürlich, freundlich und klar.', 900),
    answerMode: value.answerMode === 'rag_only' ? 'rag_only' : 'avatar'
  };
}
