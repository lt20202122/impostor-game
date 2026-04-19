import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY,
  },
});

export async function POST(request: Request) {
  const { role, secretWord, previousClues, round } = await request.json();

  let prompt = '';

  if (role === 'knows_word') {
    prompt =
      `Du spielst das Impostor-Wortspiel auf Deutsch. Das Geheimwort ist „${secretWord}". ` +
      `Es ist Runde ${round}. Die anderen Spieler haben bisher gesagt: ${
        previousClues.length ? previousClues.join(', ') : 'noch nichts'
      }. ` +
      `Gib EIN einziges deutsches Wort als Hinweis, das mit „${secretWord}" zusammenhängt, ` +
      `aber nicht identisch damit ist und nicht zu offensichtlich. Wiederhole kein bereits genanntes Wort. ` +
      `Antworte NUR mit dem einzelnen Wort in Kleinbuchstaben, ohne Satzzeichen.`;
  } else {
    prompt =
      `Du spielst das Impostor-Wortspiel auf Deutsch. Du bist der IMPOSTOR – du kennst das Geheimwort NICHT. ` +
      `Es ist Runde ${round}. Die anderen Spieler haben bisher gesagt: ${
        previousClues.length ? previousClues.join(', ') : 'noch nichts'
      }. ` +
      `Schätze anhand dieser Hinweise, welches Thema gemeint sein könnte, und gib EIN einziges deutsches Wort, ` +
      `das plausibel zum Thema passt. Versuche, nicht aufzufallen. ` +
      `Antworte NUR mit dem einzelnen Wort in Kleinbuchstaben, ohne Satzzeichen.`;
  }

  // Large, varied fallback pool — indexed by Date.now() to avoid serverless seed bias
  const FALLBACKS = [
    'kühl', 'eng', 'glatt', 'dunkel', 'leise', 'scharf', 'warm', 'hoch',
    'breit', 'alt', 'neu', 'groß', 'schnell', 'tief', 'flach', 'rund',
    'weich', 'hart', 'leer', 'voll', 'nass', 'trocken', 'blank', 'dicht',
    'weit', 'eng', 'schwer', 'leicht', 'klar', 'trüb', 'rau', 'fein',
  ];

  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.message.content.trim().toLowerCase();
    // Try each whitespace-separated token until we find a valid single German word
    const tokens = raw.split(/\s+/);
    for (const token of tokens) {
      const word = token.replace(/[^a-zäöüß]/g, '');
      if (word.length >= 3 && word.length <= 20) {
        return NextResponse.json({ clue: word });
      }
    }
    throw new Error('no valid word in response');
  } catch {
    // Use Date.now() for index entropy — avoids predictable serverless Math.random() seeds
    const idx = Date.now() % FALLBACKS.length;
    return NextResponse.json({ clue: FALLBACKS[idx] });
  }
}
