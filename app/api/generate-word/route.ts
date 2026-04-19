import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY,
  },
});

const FALLBACK_WORDS = [
  'coffee', 'beach', 'guitar', 'library', 'pizza',
  'forest', 'hospital', 'airplane', 'bicycle', 'mountain',
  'ocean', 'candle', 'umbrella', 'telescope', 'lighthouse',
  'compass', 'hammock', 'lantern', 'cactus', 'fountain',
];

export async function POST() {
  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [
        {
          role: 'user',
          content:
            'Generate a single common English noun for the Impostor word game. ' +
            'It must be a concrete, everyday object or place that players can describe with one-word clues. ' +
            'Respond with ONLY the single word in lowercase, no punctuation.',
        },
      ],
    });

    const raw = response.message.content.trim().toLowerCase();
    const word = raw.split(/\s+/)[0].replace(/[^a-z]/g, '');
    if (word.length < 2) throw new Error('bad word');
    return NextResponse.json({ word });
  } catch {
    const word = FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
    return NextResponse.json({ word });
  }
}
