import { NextResponse } from 'next/server';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'https://api.ollama.com',
  headers: {
    Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY,
  },
});

// Curated related-words for each fallback game word — used when the API fails
// so the AI gives a real clue instead of a random adjective
const WORD_ASSOCIATIONS: Record<string, string[]> = {
  labyrinth:    ['gang', 'ausweg', 'sackgasse', 'irrgarten', 'wand', 'pfad', 'verloren', 'komplex'],
  nostalgie:    ['erinnerung', 'sehnsucht', 'vergangenheit', 'heimweh', 'früher', 'vergangen'],
  quarantäne:   ['isolation', 'abstand', 'sperrung', 'getrennt', 'eingesperrt', 'allein'],
  paradox:      ['widerspruch', 'unmöglich', 'gleichzeitig', 'absurd', 'logik', 'kontradiktion'],
  periskop:     ['uboot', 'sehen', 'rohr', 'tauchen', 'blick', 'unterwasser', 'linse'],
  filibuster:   ['rede', 'abstimmung', 'parlament', 'verzögerung', 'politik', 'endlos'],
  meridian:     ['linie', 'längengrad', 'erde', 'geographie', 'mittag', 'globalus'],
  archipel:     ['inseln', 'meer', 'ozean', 'gruppe', 'küste', 'wasser', 'insel'],
  kathedrale:   ['kirche', 'turm', 'gotik', 'glocken', 'gewölbe', 'altar', 'beten'],
  karneval:     ['maske', 'kostüm', 'feier', 'bunt', 'tanz', 'verkleidung', 'rio'],
  orakel:       ['prophezeiung', 'weissagung', 'zukunft', 'geheimnis', 'tempel', 'delphie'],
  tsunami:      ['welle', 'meer', 'flut', 'zerstörung', 'erdebeben', 'ozean', 'katastrophe'],
  hieroglyphe:  ['schrift', 'ägypten', 'symbol', 'pharao', 'zeichen', 'alt', 'rätsel'],
  kolosseum:    ['gladiator', 'rom', 'amphitheater', 'arena', 'kampf', 'antike', 'zuschauer'],
  souverän:     ['unabhängig', 'frei', 'macht', 'herrscher', 'staat', 'würde', 'autorität'],
  abgrund:      ['tief', 'dunkel', 'schlucht', 'fall', 'bodenlos', 'klippe', 'steil'],
  vulkan:       ['lava', 'ausbruch', 'feuer', 'krater', 'magma', 'glut', 'explosion'],
  flüchtling:   ['heimat', 'reise', 'schutz', 'grenze', 'asyl', 'flucht', 'ankunft'],
  klostergang:  ['mönch', 'stille', 'bogen', 'innenhof', 'religion', 'kirche', 'mittelalter'],
  sarkasmus:    ['ironie', 'spott', 'witzig', 'beißend', 'zynismus', 'humor', 'scharf'],
};

// Common German stopwords to skip when parsing multi-word model responses
const STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'für', 'von', 'mit',
  'als', 'auf', 'an', 'dem', 'den', 'des', 'im', 'ich', 'du', 'es',
  'sie', 'wir', 'hier', 'mein', 'dein', 'nur', 'auch', 'nicht', 'aber',
  'kann', 'gut', 'klar', 'geben', 'sage', 'lautet', 'wort', 'hinweis',
]);

function pickFallback(role: string, secretWord: string, previousClues: string[]): string {
  if (role === 'knows_word') {
    const key = secretWord.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
    // Try exact match first, then prefix match
    const candidates =
      WORD_ASSOCIATIONS[secretWord.toLowerCase()] ??
      Object.entries(WORD_ASSOCIATIONS).find(([k]) => key.startsWith(k) || k.startsWith(key))?.[1] ??
      null;
    if (candidates) {
      const unused = candidates.filter((w) => !previousClues.includes(w));
      const pool = unused.length > 0 ? unused : candidates;
      return pool[Date.now() % pool.length];
    }
  }
  // Impostor or unknown word — pick something that could plausibly fit the clues given
  const generic = ['geheimnis', 'dunkel', 'tief', 'verborgen', 'seltsam', 'alt', 'wichtig', 'groß'];
  return generic[Date.now() % generic.length];
}

export async function POST(request: Request) {
  const { role, secretWord, previousClues, round } = await request.json();

  const prevText = previousClues.length ? previousClues.join(', ') : 'noch nichts';

  const systemPrompt =
    'Du spielst ein Wortspiel. Antworte IMMER mit genau einem einzigen deutschen Substantiv oder Adjektiv. ' +
    'Keine Erklärungen, keine Sätze, keine Satzzeichen. Nur ein Wort.';

  const userPrompt =
    role === 'knows_word'
      ? `Das Geheimwort ist „${secretWord}". Runde ${round}. Bisherige Hinweise: ${prevText}. ` +
        `Gib ein kreatives, spezifisches deutsches Wort, das zum Geheimwort passt, aber nicht identisch ist. ` +
        `Nicht eines der bereits genannten Wörter wiederholen.`
      : `Du bist der IMPOSTOR und kennst das Geheimwort NICHT. Runde ${round}. ` +
        `Die anderen sagten: ${prevText}. ` +
        `Leite daraus das Thema ab und gib ein passendes, spezifisches deutsches Wort. ` +
        `Vermeide zu generische Wörter wie 'gut', 'schön', 'interessant'.`;

  try {
    const response = await ollama.chat({
      model: 'gpt-oss:120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = response.message.content.trim().toLowerCase();
    // Walk tokens, skip German stopwords, return first real word
    const tokens = raw.split(/[\s,.:;!?„"'()[\]]+/);
    for (const token of tokens) {
      const word = token.replace(/[^a-zäöüß]/g, '');
      if (word.length >= 3 && word.length <= 20 && !STOPWORDS.has(word)) {
        return NextResponse.json({ clue: word });
      }
    }
    throw new Error('no valid word found');
  } catch {
    return NextResponse.json({ clue: pickFallback(role, secretWord, previousClues) });
  }
}
