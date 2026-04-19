import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY,
  },
});

// Harder fallback words — abstract or less obvious concepts
const FALLBACK_WORDS = [
  'Labyrinth', 'Nostalgie', 'Quarantäne', 'Paradox', 'Periskop',
  'Filibuster', 'Meridian', 'Archipel', 'Kathedrale', 'Karneval',
  'Orakel', 'Tsunami', 'Hieroglyphe', 'Kolosseum', 'Souverän',
  'Abgrund', 'Vulkan', 'Flüchtling', 'Klostergang', 'Sarkasmus',
];

export async function POST() {
  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [
        {
          role: 'user',
          content:
            'Generiere ein einziges deutsches Substantiv für das Impostor-Wortspiel. ' +
            'Das Wort soll schwierig sein: kein alltäglicher Gegenstand, sondern eher ein Konzept, ' +
            'ein Ort, ein Ereignis oder ein weniger gebräuchlicher Begriff, der trotzdem bekannt ist. ' +
            'Beispiele für den gewünschten Schwierigkeitsgrad: Labyrinth, Nostalgie, Quarantäne, Archipel, Meridian. ' +
            'Antworte NUR mit dem einzelnen Wort, ohne Artikel, ohne Satzzeichen.',
        },
      ],
    });

    const raw = response.message.content.trim();
    // Allow German chars, strip punctuation
    const word = raw.split(/\s+/)[0].replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
    if (word.length < 3) throw new Error('bad word');
    return NextResponse.json({ word });
  } catch {
    const word = FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
    return NextResponse.json({ word });
  }
}
