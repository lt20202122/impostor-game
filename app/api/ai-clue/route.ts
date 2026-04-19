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

  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.message.content.trim().toLowerCase();
    const clue = raw.split(/\s+/)[0].replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
    if (clue.length < 2) throw new Error('bad clue');
    return NextResponse.json({ clue });
  } catch {
    const fallbacks = ['rätselhaft', 'interessant', 'vertraut', 'merkwürdig', 'seltsam'];
    return NextResponse.json({ clue: fallbacks[Math.floor(Math.random() * fallbacks.length)] });
  }
}
