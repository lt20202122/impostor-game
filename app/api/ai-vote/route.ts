import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
});

interface PlayerClues {
  name: string;
  clues: string[];
}

export async function POST(request: Request) {
  const {
    role,          // 'knows_word' | 'impostor'
    secretWord,    // string (empty if AI is impostor)
    allClues,      // PlayerClues[]
    aiName,        // AI's own name (to avoid self-accusation when impostor)
  }: { role: string; secretWord: string; allClues: PlayerClues[]; aiName: string } =
    await request.json();

  const cluesSummary = allClues
    .map((p) => `${p.name}: ${p.clues.length ? p.clues.join(', ') : '(keine Hinweise)'}`)
    .join('\n');

  const otherPlayers = allClues.filter((p) => p.name !== aiName);

  let prompt = '';

  if (role === 'knows_word') {
    prompt =
      `Du spielst das Impostor-Wortspiel. Das Geheimwort ist „${secretWord}". ` +
      `Du bist KEIN Impostor und kennst das Wort.\n` +
      `Die Hinweise aller Spieler waren:\n${cluesSummary}\n\n` +
      `Analysiere die Hinweise kritisch. Der Impostor weiß das Wort nicht und gibt deshalb vage, ` +
      `zu generische oder unpassende Hinweise. Entscheide, wer der Impostor ist.\n` +
      `Antworte auf Deutsch in GENAU diesem Format (keine anderen Zeilen):\n` +
      `Name: [nur der Name des Verdächtigen]\n` +
      `Begründung: [1-2 Sätze, warum du das glaubst]`;
  } else {
    const targets = otherPlayers.map((p) => p.name).join(', ');
    prompt =
      `Du spielst das Impostor-Wortspiel. Du bist der IMPOSTOR – du kennst das Geheimwort nicht.\n` +
      `Du musst jetzt strategisch einen anderen Spieler beschuldigen, damit du nicht auffällst.\n` +
      `Die anderen Spieler sind: ${targets}.\n` +
      `Die Hinweise aller Spieler waren:\n${cluesSummary}\n\n` +
      `Beschuldige einen der anderen Spieler (NICHT dich selbst, also NICHT „${aiName}"). ` +
      `Erfinde eine glaubhafte Begründung, warum dieser Spieler verdächtig wirkt.\n` +
      `Antworte auf Deutsch in GENAU diesem Format (keine anderen Zeilen):\n` +
      `Name: [nur der Name des Verdächtigen – nicht ${aiName}]\n` +
      `Begründung: [1-2 Sätze Begründung]`;
  }

  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.message.content.trim();
    const nameMatch = text.match(/Name:\s*(.+)/i);
    const reasonMatch = text.match(/Begründung:\s*([\s\S]+)/i);

    let accusedName = nameMatch?.[1]?.trim() ?? '';

    // Safety: if AI accused itself (when it's the impostor), fallback to another player
    if (!accusedName || accusedName.toLowerCase() === aiName.toLowerCase()) {
      accusedName = otherPlayers[0]?.name ?? allClues[0]?.name ?? 'Unbekannt';
    }

    const reasoning =
      reasonMatch?.[1]?.trim() ?? 'Die Hinweise wirkten vage und nicht überzeugend.';

    return NextResponse.json({ accusedName, reasoning });
  } catch {
    const fallback = otherPlayers[0]?.name ?? allClues[0]?.name ?? 'Unbekannt';
    return NextResponse.json({
      accusedName: fallback,
      reasoning: 'Die Hinweise dieses Spielers wirkten zu unspezifisch und verdächtig.',
    });
  }
}
