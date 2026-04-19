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
  | 'round-ai'         // AI is fetching its clue
  | 'round-ai-reveal'  // Show AI's clue to everyone before continuing
  | 'round-transition'
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
  impostorIndex: number; // 0=P1, 1=P2, 2=AI
  phase: Phase;
  clues: ClueEntry[][];  // clues[round][entry]
  currentRound: number;
  currentPlayerInRound: number;
  inputValue: string;
  error: string;
  // After AI round: pending state to display before advancing
  pendingNextRound: number;
  pendingGoToResults: boolean;
}

const INITIAL: GameState = {
  p1Name: '',
  p2Name: '',
  aiName: 'HAL-9000',
  secretWord: '',
  impostorIndex: 0,
  phase: 'setup',
  clues: [[], []],
  currentRound: 0,
  currentPlayerInRound: 0,
  inputValue: '',
  error: '',
  pendingNextRound: 0,
  pendingGoToResults: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function playerName(state: GameState, idx: number) {
  if (idx === 0) return state.p1Name || 'Spieler 1';
  if (idx === 1) return state.p2Name || 'Spieler 2';
  return state.aiName;
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
      const impostorIndex = Math.floor(Math.random() * 3);
      update({
        secretWord: word,
        impostorIndex,
        clues: [[], []],
        currentRound: 0,
        currentPlayerInRound: 0,
        phase: 'pass-to-0',
      });
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
      update({ phase: 'round-input', currentRound: 0, currentPlayerInRound: 0 });
    }
  }

  // ── Rounds ────────────────────────────────────────────────────────────

  function submitClue() {
    const clue = s.inputValue.trim().toLowerCase();
    if (!clue || clue.split(/\s+/).length > 1) {
      update({ error: 'Gib genau ein Wort ein.' });
      return;
    }

    const entry: ClueEntry = {
      name: playerName(s, s.currentPlayerInRound),
      clue,
      isAI: false,
      isImpostor: s.currentPlayerInRound === s.impostorIndex,
    };

    const newClues = s.clues.map((r, i) =>
      i === s.currentRound ? [...r, entry] : r
    );
    const nextPlayer = s.currentPlayerInRound + 1;

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
      fetchAIClue(newClues, s.currentRound);
    } else {
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

  async function fetchAIClue(clues: ClueEntry[][], round: number) {
    // Capture the stable values we need from current state
    const role = s.impostorIndex === 2 ? 'impostor' : 'knows_word';
    const prevClues = clues[round].filter((c) => !c.isAI).map((c) => c.clue);
    const aiName = s.aiName;
    const secretWord = s.secretWord;
    const impostorIndex = s.impostorIndex;

    let clue = 'rätselhaft';
    try {
      const res = await fetch('/api/ai-clue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, secretWord, previousClues: prevClues, round: round + 1 }),
      });
      const data = await res.json();
      if (data.clue && data.clue.length >= 2) clue = data.clue;
    } catch {
      // use fallback
    }

    const entry: ClueEntry = {
      name: aiName,
      clue,
      isAI: true,
      isImpostor: impostorIndex === 2,
    };

    const newClues = clues.map((r, i) => (i === round ? [...r, entry] : r));
    const nextRound = round + 1;

    // Go to reveal phase so everyone can see what the AI said
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
      update({ phase: 'results' });
    } else {
      update({
        phase: 'round-transition',
        currentRound: s.pendingNextRound,
        currentPlayerInRound: 0,
      });
    }
  }

  function continueFromTransition() {
    update({ phase: 'round-input' });
  }

  function playAgain() {
    setS({ ...INITIAL, p1Name: s.p1Name, p2Name: s.p2Name, aiName: s.aiName });
  }

  const isImpostor = (idx: number) => s.impostorIndex === idx;

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
            <p>• Kannst du den Impostor entlarven?</p>
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
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-2">Gib das Handy an</p>
            <h2 className="text-4xl font-bold">{playerName(s, idx)}</h2>
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
          name={playerName(s, idx)}
          isImpostor={isImpostor(idx)}
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
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-2">Gib das Handy an</p>
            <h2 className="text-4xl font-bold">{playerName(s, s.currentPlayerInRound)}</h2>
            <p className="text-zinc-400 text-sm mt-1">weiter</p>
          </div>
          <p className="text-zinc-500 text-sm">Du bist als Nächstes mit einem Hinweis dran</p>
          <Btn onClick={continueFromTransition}>Ich bin bereit</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-input') {
    const name = playerName(s, s.currentPlayerInRound);
    const imp = isImpostor(s.currentPlayerInRound);
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-5">
          <div className="text-center">
            <div className="bg-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-300 inline-block mb-3">
              Runde {s.currentRound + 1} von 2
            </div>
            <h2 className="text-2xl font-bold">{name} ist dran</h2>
            {imp ? (
              <p className="text-red-400 text-sm mt-1">
                Du bist der Impostor – versuche, nicht aufzufallen!
              </p>
            ) : (
              <p className="text-zinc-400 text-sm mt-1">
                Das Wort lautet{' '}
                <span className="font-bold text-white">„{s.secretWord}"</span>
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
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-1">{s.aiName} hat getippt</p>
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
            {s.pendingGoToResults ? 'Ergebnis anzeigen' : 'Nächste Runde →'}
          </Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'results') {
    const impostorName = playerName(s, s.impostorIndex);
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-5 pb-8">
          <div className="text-center">
            <div className="text-5xl mb-3">🎭</div>
            <h1 className="text-3xl font-bold">Spiel vorbei!</h1>
          </div>

          <div className="bg-violet-900/40 border border-violet-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Das Geheimwort war</p>
            <p className="text-4xl font-black text-violet-300">„{s.secretWord}"</p>
          </div>

          <div className="bg-red-900/40 border border-red-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-400 text-xs uppercase tracking-widest mb-1">Der Impostor war</p>
            <p className="text-4xl font-black text-red-400">{impostorName}</p>
            <p className="text-zinc-400 text-xs mt-2">
              {s.impostorIndex === 2
                ? 'Die KI hat die ganze Zeit gelogen!'
                : 'Der hatte keine Ahnung, was das Wort war!'}
            </p>
          </div>

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
  variant = 'primary',
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const base =
    'w-full py-4 px-6 rounded-2xl font-semibold text-base active:scale-95 transition-all duration-150 cursor-pointer';
  const styles = {
    primary: `${base} bg-violet-600 hover:bg-violet-500 text-white`,
    secondary: `${base} bg-zinc-800 hover:bg-zinc-700 text-zinc-200`,
  };
  return (
    <button className={styles[variant]} onClick={onClick}>
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
