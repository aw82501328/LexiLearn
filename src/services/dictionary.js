/**
 * Free Dictionary API — https://dictionaryapi.dev/
 * Instant word lookup, no API key required.
 */

const BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// In-memory cache to avoid repeated network requests
const cache = new Map();

export async function lookupWord(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) {
    return cache.get(key);
  }

  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new Error('未找到该单词');
  }

  const entries = await res.json();
  const result = parseEntries(entries);

  cache.set(key, result);
  return result;
}

function parseEntries(entries) {
  const first = entries[0];
  if (!first) throw new Error('未找到释义');

  // Phonetic
  let phonetic = '';
  if (first.phonetic) {
    phonetic = first.phonetic;
  } else if (first.phonetics?.length) {
    const ipa = first.phonetics.find((p) => p.text);
    phonetic = ipa?.text || '';
  }
  phonetic = phonetic.replace(/\//g, '');

  // Collect all entries: { pos, english (definition), example }
  const result = [];

  if (first.meanings) {
    for (const meaning of first.meanings) {
      const pos = meaning.partOfSpeech || '';
      for (const def of meaning.definitions) {
        if (def.definition) {
          result.push({
            pos,
            english: def.definition,
            example: def.example || null,
          });
        }
      }
    }
  }

  return {
    phonetic,
    entries: result,
  };
}
