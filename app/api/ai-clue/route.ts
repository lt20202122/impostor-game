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
      `You are playing the Impostor word game. The secret word is "${secretWord}". ` +
      `It is round ${round}. Other players have said: ${previousClues.length ? previousClues.join(', ') : 'nothing yet'}. ` +
      `Give ONE single English word as a clue that is related to "${secretWord}" but not identical to it and not too obvious. ` +
      `Do NOT repeat a word already said. Respond with ONLY that single lowercase word, no punctuation.`;
  } else {
    prompt =
      `You are playing the Impostor word game. You are the IMPOSTOR — you do NOT know the secret word. ` +
      `It is round ${round}. Other players have said: ${previousClues.length ? previousClues.join(', ') : 'nothing yet'}. ` +
      `Based on their clues, make your best guess about the theme and give ONE single English word that could plausibly fit in. ` +
      `Try hard to blend in. Respond with ONLY that single lowercase word, no punctuation.`;
  }

  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.message.content.trim().toLowerCase();
    const clue = raw.split(/\s+/)[0].replace(/[^a-z]/g, '');
    if (clue.length < 2) throw new Error('bad clue');
    return NextResponse.json({ clue });
  } catch {
    const fallbacks = ['intriguing', 'mysterious', 'curious', 'interesting', 'familiar'];
    return NextResponse.json({ clue: fallbacks[Math.floor(Math.random() * fallbacks.length)] });
  }
}
