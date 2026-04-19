'use client';

import { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type Phase =
  | 'setup'
  | 'generating'
  | 'pass-to-0'
  | 'show-role-0'
  | 'pass-to-1'
  | 'show-role-1'
  | 'round-input'
  | 'round-ai'          // AI fetching its clue
  | 'round-ai-reveal'   // Everyone sees the AI's clue
  | 'round-transition'  // Phone-pass screen between players
  | 'ai-voting'         // AI deliberating who the impostor is
  | 'ai-verdict'        // AI reveals its accusation
  | 'results';

interface ClueEntry {
  name: string;
  clue: string;
  isAI: boolean;
  isImpostor: boolean;
}

interface GameState {
  p1Name: string;
  p2Name: string;
  aiName: string;
  secretWord: string;
  impostorIndex: number;              // 0=P1, 1=P2, 2=AI — set once, never mutated
  turnOrder: [number, number, number]; // shuffled clue order, e.g. [1, 0, 2]
  phase: Phase;
  clues: ClueEntry[][];               // clues[round][entry]
  currentRound: number;
  currentPlayerInRound: number;       // actual player index (0,1,2), not position
  inputValue: string;
  error: string;
  pendingNextRound: number;
  pendingGoToResults: boolean;
  aiAccusedName: string;
  aiReasoning: string;
}

const INITIAL: GameState = {
  p1Name: '',
  p2Name: '',
  aiName: 'HAL-9000',
  secretWord: '',
  impostorIndex: -1,
  turnOrder: [0, 1, 2],
  phase: 'setup',
  clues: [[], []],
  currentRound: 0,
  currentPlayerInRound: 0,
  inputValue: '',
  error: '',
  pendingNextRound: 0,
  pendingGoToResults: false,
  aiAccusedName: '',
  aiReasoning: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pName(state: GameState, idx: number) {
  if (idx === 0) return state.p1Name || 'Spieler 1';
  if (idx === 1) return state.p2Name || 'Spieler 2';
  return state.aiName;
}

function gatherCluesByPlayer(state: GameState) {
  const players = [pName(state, 0), pName(state, 1), state.aiName];
  return players.map((name) => ({
    name,
    clues: state.clues.flatMap((round) =>
      round.filter((c) => c.name === name).map((c) => c.clue)
    ),
  }));
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GamePage() {
  const [s, setS] = useState<GameState>(INITIAL);

  const update = useCallback((patch: Partial<GameState>) => {
    setS((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Setup ─────────────────────────────────────────────────────────────

  async function startGame() {
    if (!s.p1Name.trim() || !s.p2Name.trim()) {
      update({ error: 'Bitte gib beide Spielernamen ein.' });
      return;
    }
    if (s.p1Name.trim().toLowerCase() === s.p2Name.trim().toLowerCase()) {
      update({ error: 'Die Spielernamen müssen unterschiedlich sein.' });
      return;
    }

    update({ error: '', phase: 'generating' });

    try {
      const res = await fetch('/api/generate-word', { method: 'POST' });
      const { word } = await res.json();
      // Compute impostorIndex and turnOrder atomically with secretWord.
      // Splitting across two updates risks the second update's functional `prev` reading
      // the pre-first-update state (React 18 batching edge case), leaving impostorIndex = -1.
      const impostorIndex = Math.floor(Math.random() * 3);
      // Shuffle the two humans; AI always goes last so the round-ai-reveal logic stays simple
      const humanFirst = Math.random() < 0.5 ? 0 : 1;
      const turnOrder: [number, number, number] = [humanFirst, humanFirst === 0 ? 1 : 0, 2];
      setS((prev) => ({
        ...prev,
        secretWord: word,
        impostorIndex,
        turnOrder,
        clues: [[], []],
        currentRound: 0,
        currentPlayerInRound: turnOrder[0], // first to give a clue
        phase: 'pass-to-0',
        error: '',
      }));
    } catch {
      update({ error: 'Fehler beim Generieren des Worts. Bitte erneut versuchen.', phase: 'setup' });
    }
  }

  // ── Reveal ────────────────────────────────────────────────────────────

  function showRole(playerIdx: 0 | 1) {
    update({ phase: playerIdx === 0 ? 'show-role-0' : 'show-role-1' });
  }

  function doneRevealing(playerIdx: 0 | 1) {
    if (playerIdx === 0) {
      update({ phase: 'pass-to-1' });
    } else {
      // First clue-giver is turnOrder[0]; currentPlayerInRound was already set in startGame
      update({ phase: 'round-input', currentRound: 0 });
    }
  }

  // ── Rounds ────────────────────────────────────────────────────────────

  function submitClue() {
    const clue = s.inputValue.trim().toLowerCase();
    if (!clue || clue.split(/\s+/).length > 1) {
      update({ error: 'Gib genau ein Wort ein.' });
      return;
    }

    // Snapshot values now (before any setS) to avoid closure staleness
    const snapImpostorIndex = s.impostorIndex;
    const snapRound = s.currentRound;
    const snapAiName = s.aiName;
    const snapSecretWord = s.secretWord;
    const snapTurnOrder = s.turnOrder;

    const entry: ClueEntry = {
      name: pName(s, s.currentPlayerInRound),
      clue,
      isAI: false,
      isImpostor: s.currentPlayerInRound === snapImpostorIndex,
    };

    const newClues = s.clues.map((r, i) =>
      i === snapRound ? [...r, entry] : r
    );

    // Advance through turnOrder — find current position, step to next
    const currentPos = snapTurnOrder.indexOf(s.currentPlayerInRound);
    const nextPos = currentPos + 1;
    const nextPlayer = nextPos < 3 ? snapTurnOrder[nextPos] : -1;

    if (nextPlayer === 2) {
      // AI's turn
      setS((prev) => ({
        ...prev,
        clues: newClues,
        inputValue: '',
        error: '',
        currentPlayerInRound: 2,
        phase: 'round-ai',
      }));
      fetchAIClue(newClues, snapRound, snapImpostorIndex, snapSecretWord, snapAiName);
    } else if (nextPlayer !== -1) {
      // Next human's turn
      setS((prev) => ({
        ...prev,
        clues: newClues,
        inputValue: '',
        error: '',
        currentPlayerInRound: nextPlayer,
        phase: 'round-transition',
      }));
    }
  }

  // All values are passed explicitly — no stale closure risk
  async function fetchAIClue(
    clues: ClueEntry[][],
    round: number,
    impostorIndex: number,
    secretWord: string,
    aiName: string,
  ) {
    const role = impostorIndex === 2 ? 'impostor' : 'knows_word';
    const prevClues = clues[round].filter((c) => !c.isAI).map((c) => c.clue);

    let clue = 'rätselhaft';
    try {
      const res = await fetch('/api/ai-clue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, secretWord, previousClues: prevClues, round: round + 1 }),
      });
      const data = await res.json();
      if (data.clue?.length >= 2) clue = data.clue;
    } catch { /* use fallback */ }

    const entry: ClueEntry = {
      name: aiName,
      clue,
      isAI: true,
      isImpostor: impostorIndex === 2,
    };

    const newClues = clues.map((r, i) => (i === round ? [...r, entry] : r));
    const nextRound = round + 1;

    setS((prev) => ({
      ...prev,
      clues: newClues,
      phase: 'round-ai-reveal',
      pendingNextRound: nextRound,
      pendingGoToResults: nextRound >= 2,
    }));
  }

  function continueAfterAIReveal() {
    if (s.pendingGoToResults) {
      // Last round done — now the AI votes
      const snapImpostorIndex = s.impostorIndex;
      const snapSecretWord = s.secretWord;
      const snapAiName = s.aiName;
      update({ phase: 'ai-voting' });
      fetchAIVote(s, snapImpostorIndex, snapSecretWord, snapAiName);
    } else {
      // Start next round with the first player in turnOrder
      update({
        phase: 'round-transition',
        currentRound: s.pendingNextRound,
        currentPlayerInRound: s.turnOrder[0],
      });
    }
  }

  async function fetchAIVote(
    currentState: GameState,
    impostorIndex: number,
    secretWord: string,
    aiName: string,
  ) {
    const role = impostorIndex === 2 ? 'impostor' : 'knows_word';
    const allClues = gatherCluesByPlayer(currentState);
    const p1 = currentState.p1Name || 'Spieler 1';
    const p2 = currentState.p2Name || 'Spieler 2';

    try {
      const res = await fetch('/api/ai-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, secretWord, allClues, aiName }),
      });
      const { accusedName, reasoning } = await res.json();

      // Safety: AI must not accuse itself
      let safeName = accusedName;
      if (!safeName || safeName.toLowerCase() === aiName.toLowerCase()) {
        safeName = p1;
      }

      setS((prev) => ({
        ...prev,
        aiAccusedName: safeName,
        aiReasoning: reasoning,
        phase: 'ai-verdict',
      }));
    } catch {
      setS((prev) => ({
        ...prev,
        aiAccusedName: p1,
        aiReasoning: 'Die Hinweise dieses Spielers wirkten unspezifisch und verdächtig.',
        phase: 'ai-verdict',
      }));
    }
  }

  function continueFromTransition() {
    update({ phase: 'round-input' });
  }

  function playAgain() {
    setS({ ...INITIAL, p1Name: s.p1Name, p2Name: s.p2Name, aiName: s.aiName, turnOrder: [0, 1, 2] });
  }

  // ── Screens ───────────────────────────────────────────────────────────

  if (s.phase === 'setup') {
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6">
          <div className="text-center">
            <div className="text-5xl mb-3">🕵️</div>
            <h1 className="text-3xl font-bold tracking-tight">Impostor</h1>
            <p className="text-zinc-400 mt-2 text-sm leading-relaxed">
              Zwei Spieler kennen das Wort. Einer ist der Impostor.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Field
              label="Name Spieler 1"
              value={s.p1Name}
              onChange={(v) => update({ p1Name: v, error: '' })}
              placeholder="z.B. Alex"
            />
            <Field
              label="Name Spieler 2"
              value={s.p2Name}
              onChange={(v) => update({ p2Name: v, error: '' })}
              placeholder="z.B. Jordan"
            />
            <Field
              label="Name des KI-Spielers"
              value={s.aiName}
              onChange={(v) => update({ aiName: v })}
              placeholder="z.B. HAL-9000"
            />
          </div>

          {s.error && <p className="text-red-400 text-sm text-center">{s.error}</p>}

          <Btn onClick={startGame}>Spiel starten</Btn>

          <div className="text-zinc-500 text-xs text-center space-y-1.5">
            <p>• 3 Spieler: du, dein Freund und eine KI</p>
            <p>• 2 Runden mit je einem Hinweiswort</p>
            <p>• Die KI stimmt am Ende ab, wer der Impostor ist</p>
          </div>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'generating') {
    return (
      <Screen>
        <div className="text-center fade-up flex flex-col items-center gap-4">
          <div className="text-5xl pulse-slow">🤖</div>
          <p className="text-xl font-semibold">Geheimwort wird generiert…</p>
          <p className="text-zinc-400 text-sm">Die KI wählt ein Wort</p>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'pass-to-0' || s.phase === 'pass-to-1') {
    const idx = s.phase === 'pass-to-0' ? 0 : 1;
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Gib das Handy an</p>
            <h2 className="text-4xl font-bold">{pName(s, idx)}</h2>
            <p className="text-zinc-400 text-sm mt-1">weiter</p>
          </div>
          <p className="text-zinc-500 text-sm">Niemand sonst darf zuschauen!</p>
          <Btn onClick={() => showRole(idx as 0 | 1)}>Ich bin bereit 👀</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'show-role-0' || s.phase === 'show-role-1') {
    const idx = s.phase === 'show-role-0' ? 0 : 1;
    return (
      <Screen>
        <RoleReveal
          name={pName(s, idx)}
          isImpostor={s.impostorIndex === idx}
          word={s.secretWord}
          onDone={() => doneRevealing(idx as 0 | 1)}
        />
      </Screen>
    );
  }

  if (s.phase === 'round-transition') {
    const isNewRound = s.currentPlayerInRound === 0;
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          {isNewRound && (
            <div className="bg-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-300 self-center">
              Runde {s.currentRound + 1} von 2
            </div>
          )}
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Gib das Handy an</p>
            <h2 className="text-4xl font-bold">{pName(s, s.currentPlayerInRound)}</h2>
            <p className="text-zinc-400 text-sm mt-1">weiter</p>
          </div>
          <p className="text-zinc-500 text-sm">Du bist als Nächstes mit einem Hinweis dran</p>
          <Btn onClick={continueFromTransition}>Ich bin bereit</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-input') {
    const name = pName(s, s.currentPlayerInRound);
    const imp = s.currentPlayerInRound === s.impostorIndex;
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-5">
          <div className="text-center">
            <div className="bg-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-300 inline-block mb-3">
              Runde {s.currentRound + 1} von 2
            </div>
            <h2 className="text-2xl font-bold">{name} ist dran</h2>
            {imp && (
              <p className="text-red-400 text-sm mt-1 font-medium">
                🕵️ Du bist der Impostor – versuche, nicht aufzufallen!
              </p>
            )}
          </div>

          {s.clues[s.currentRound].length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Bisherige Hinweise</p>
              <div className="space-y-2">
                {s.clues[s.currentRound].map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-zinc-400">{c.name}</span>
                    <span className="font-medium">{c.clue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-400">Dein Hinweiswort</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-violet-500 placeholder-zinc-600"
              placeholder="Ein Wort eingeben…"
              value={s.inputValue}
              onChange={(e) => update({ inputValue: e.target.value, error: '' })}
              onKeyDown={(e) => e.key === 'Enter' && submitClue()}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {s.error && <p className="text-red-400 text-sm">{s.error}</p>}
          </div>

          <Btn onClick={submitClue}>Hinweis abgeben</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-ai') {
    return (
      <Screen>
        <div className="text-center fade-up flex flex-col items-center gap-5">
          <div className="text-6xl pulse-slow">🤖</div>
          <div>
            <h2 className="text-2xl font-bold">{s.aiName} denkt nach…</h2>
            <p className="text-zinc-400 text-sm mt-1">Hinweis wird generiert</p>
          </div>
          {s.clues[s.currentRound].length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 w-full max-w-xs">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Bisherige Hinweise</p>
              <div className="space-y-2">
                {s.clues[s.currentRound].map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-zinc-400">{c.name}</span>
                    <span className="font-medium">{c.clue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-ai-reveal') {
    const aiEntry = s.clues[s.currentRound].find((c) => c.isAI);
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          <div>
            <div className="text-5xl mb-3">🤖</div>
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">
              {s.aiName} hat getippt
            </p>
            <p className="text-5xl font-black text-violet-300 mt-2">{aiEntry?.clue ?? '?'}</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
              Alle Hinweise – Runde {s.currentRound + 1}
            </p>
            <div className="space-y-2">
              {s.clues[s.currentRound].map((c, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className={c.isAI ? 'text-violet-400' : 'text-zinc-400'}>
                    {c.name}{c.isAI ? ' 🤖' : ''}
                  </span>
                  <span className="font-medium">{c.clue}</span>
                </div>
              ))}
            </div>
          </div>

          <Btn onClick={continueAfterAIReveal}>
            {s.pendingGoToResults ? 'KI stimmt ab →' : 'Nächste Runde →'}
          </Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'ai-voting') {
    return (
      <Screen>
        <div className="text-center fade-up flex flex-col items-center gap-5">
          <div className="text-6xl pulse-slow">🤔</div>
          <div>
            <h2 className="text-2xl font-bold">{s.aiName} überlegt…</h2>
            <p className="text-zinc-400 text-sm mt-1">Wer ist der Impostor?</p>
          </div>
          <div className="text-zinc-500 text-xs text-center space-y-1 max-w-xs">
            <p>Die KI analysiert alle Hinweise</p>
            <p>und entscheidet, wen sie verdächtigt.</p>
          </div>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'ai-verdict') {
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          <div>
            <div className="text-5xl mb-3">🤖</div>
            <h2 className="text-2xl font-bold">Das Urteil der KI</h2>
          </div>

          <div className="bg-amber-900/40 border border-amber-600 rounded-2xl p-6">
            <p className="text-amber-300 text-xs uppercase tracking-widest mb-2">
              {s.aiName} verdächtigt
            </p>
            <p className="text-4xl font-black text-amber-200">{s.aiAccusedName}</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-left">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Begründung</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{s.aiReasoning}</p>
          </div>

          <Btn onClick={() => update({ phase: 'results' })}>Ergebnis anzeigen</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'results') {
    const impostorName = pName(s, s.impostorIndex);
    const aiWasRight = s.aiAccusedName === impostorName;
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-5 pb-8">
          <div className="text-center">
            <div className="text-5xl mb-3">🎭</div>
            <h1 className="text-3xl font-bold">Spiel vorbei!</h1>
          </div>

          {/* Secret word */}
          <div className="bg-violet-900/40 border border-violet-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Das Geheimwort war</p>
            <p className="text-4xl font-black text-violet-300">„{s.secretWord}"</p>
          </div>

          {/* Impostor reveal */}
          <div className="bg-red-900/40 border border-red-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Der Impostor war</p>
            <p className="text-4xl font-black text-red-400">{impostorName}</p>
            <p className="text-zinc-400 text-xs mt-2">
              {s.impostorIndex === 2
                ? 'Die KI hat die ganze Zeit gelogen!'
                : 'Der hatte keine Ahnung, was das Wort war!'}
            </p>
          </div>

          {/* AI verdict vs truth */}
          <div
            className={`rounded-2xl p-4 text-center border ${
              aiWasRight
                ? 'bg-green-900/40 border-green-700'
                : 'bg-zinc-900 border-zinc-800'
            }`}
          >
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">
              KI-Tipp: {s.aiAccusedName}
            </p>
            <p className={`font-bold text-sm ${aiWasRight ? 'text-green-400' : 'text-zinc-400'}`}>
              {aiWasRight ? '✓ Die KI lag richtig!' : '✗ Die KI lag falsch.'}
            </p>
          </div>

          {/* All clues */}
          <div className="flex flex-col gap-3">
            {(['Runde 1', 'Runde 2'] as const).map((label, ri) => (
              <div key={ri} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{label}</p>
                <div className="space-y-2">
                  {s.clues[ri].map((c, ci) => (
                    <div key={ci} className="flex items-center justify-between text-sm">
                      <span
                        className={
                          c.isImpostor
                            ? 'text-red-400 font-semibold'
                            : c.isAI
                            ? 'text-violet-400'
                            : 'text-zinc-300'
                        }
                      >
                        {c.name}
                        {c.isImpostor && ' 🕵️'}
                        {c.isAI && !c.isImpostor && ' 🤖'}
                      </span>
                      <span className="font-medium text-white">{c.clue}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Btn onClick={playAgain}>Nochmal spielen</Btn>
        </div>
      </Screen>
    );
  }

  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-5">
      <div className="w-full">{children}</div>
    </main>
  );
}

function Btn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="w-full py-4 px-6 rounded-2xl font-semibold text-base bg-violet-600 hover:bg-violet-500 text-white active:scale-95 transition-all duration-150 cursor-pointer"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-zinc-400">{label}</label>
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 placeholder-zinc-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCorrect="off"
      />
    </div>
  );
}

function RoleReveal({
  name,
  isImpostor,
  word,
  onDone,
}: {
  name: string;
  isImpostor: boolean;
  word: string;
  onDone: () => void;
}) {
  return (
    <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
      <p className="text-zinc-400 text-sm uppercase tracking-widest">{name}</p>

      {isImpostor ? (
        <div className="flex flex-col items-center gap-4">
          <div className="text-6xl">🕵️</div>
          <div className="bg-red-900/40 border border-red-700 rounded-2xl p-6 w-full">
            <p className="text-red-400 text-xs uppercase tracking-widest mb-2">Du bist</p>
            <p className="text-4xl font-black text-red-300">Der Impostor!</p>
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed px-2">
            Du kennst das Geheimwort nicht. Höre den anderen zu und versuche, nicht aufzufallen!
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-6xl">🔑</div>
          <div className="bg-violet-900/40 border border-violet-700 rounded-2xl p-6 w-full">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Das Geheimwort ist</p>
            <p className="text-4xl font-black text-violet-300">„{word}"</p>
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed px-2">
            Gib Hinweise, die zum Wort passen – aber nicht zu offensichtlich!
          </p>
        </div>
      )}

      <Btn onClick={onDone}>Verstanden – fertig!</Btn>
    </div>
  );
}
