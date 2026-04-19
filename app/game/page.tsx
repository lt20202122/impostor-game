'use client';

import { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type Phase =
  | 'setup'
  | 'generating'
  | 'pass-to-0'       // cover: hand phone to player 0
  | 'show-role-0'     // player 0 sees their role
  | 'pass-to-1'       // cover: hand phone to player 1
  | 'show-role-1'     // player 1 sees their role
  | 'round-input'     // current human player types a clue
  | 'round-ai'        // AI is generating its clue
  | 'round-transition'// brief screen between players
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
  // 0 = player1, 1 = player2, 2 = AI
  impostorIndex: number;
  phase: Phase;
  // Rounds: two rounds, three players each
  // clues[round][playerIndex]
  clues: ClueEntry[][];
  currentRound: number; // 0 or 1
  currentPlayerInRound: number; // 0, 1, 2
  inputValue: string;
  error: string;
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
};

// ── Helpers ────────────────────────────────────────────────────────────────

function playerName(state: GameState, idx: number) {
  if (idx === 0) return state.p1Name || 'Player 1';
  if (idx === 1) return state.p2Name || 'Player 2';
  return state.aiName;
}

function cluesBeforeAI(state: GameState, round: number): string[] {
  return state.clues[round]
    .filter((c) => !c.isAI)
    .map((c) => c.clue);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GamePage() {
  const [s, setS] = useState<GameState>(INITIAL);

  const update = useCallback((patch: Partial<GameState>) => {
    setS((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Setup → generate word ─────────────────────────────────────────────

  async function startGame() {
    if (!s.p1Name.trim() || !s.p2Name.trim()) {
      update({ error: 'Please enter both player names.' });
      return;
    }
    if (s.p1Name.trim().toLowerCase() === s.p2Name.trim().toLowerCase()) {
      update({ error: 'Player names must be different.' });
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
      update({ error: 'Failed to generate a word. Please try again.', phase: 'setup' });
    }
  }

  // ── Reveal phase ──────────────────────────────────────────────────────

  function showRole(playerIdx: 0 | 1) {
    update({ phase: playerIdx === 0 ? 'show-role-0' : 'show-role-1' });
  }

  function doneRevealing(playerIdx: 0 | 1) {
    if (playerIdx === 0) {
      update({ phase: 'pass-to-1' });
    } else {
      // Both humans revealed. Start rounds — if AI goes first (player 2 = AI),
      // the AI would be playerInRound index 2. But we always go P1 → P2 → AI.
      update({ phase: 'round-input', currentRound: 0, currentPlayerInRound: 0 });
    }
  }

  // ── Rounds ────────────────────────────────────────────────────────────

  function submitClue() {
    const clue = s.inputValue.trim().toLowerCase();
    if (!clue || clue.split(/\s+/).length > 1) {
      update({ error: 'Enter exactly one word.' });
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
      // Next is AI
      setS((prev) => ({
        ...prev,
        clues: newClues,
        inputValue: '',
        error: '',
        currentPlayerInRound: 2,
        phase: 'round-ai',
      }));
      fetchAIClue(newClues, s.currentRound, 2);
    } else {
      // Next is human player 2
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

  async function fetchAIClue(clues: ClueEntry[][], round: number, _aiIdx: number) {
    const role = s.impostorIndex === 2 ? 'impostor' : 'knows_word';
    const prevClues = clues[round].filter((c) => !c.isAI).map((c) => c.clue);

    try {
      const res = await fetch('/api/ai-clue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          secretWord: s.secretWord,
          previousClues: prevClues,
          round: round + 1,
        }),
      });
      const { clue } = await res.json();

      const entry: ClueEntry = {
        name: s.aiName,
        clue,
        isAI: true,
        isImpostor: s.impostorIndex === 2,
      };

      const newClues = clues.map((r, i) =>
        i === round ? [...r, entry] : r
      );

      const nextRound = round + 1;
      if (nextRound >= 2) {
        setS((prev) => ({ ...prev, clues: newClues, phase: 'results' }));
      } else {
        setS((prev) => ({
          ...prev,
          clues: newClues,
          currentRound: nextRound,
          currentPlayerInRound: 0,
          phase: 'round-transition',
        }));
      }
    } catch {
      // Fallback clue
      const entry: ClueEntry = {
        name: s.aiName,
        clue: 'mysterious',
        isAI: true,
        isImpostor: s.impostorIndex === 2,
      };
      const newClues = clues.map((r, i) =>
        i === round ? [...r, entry] : r
      );
      const nextRound = round + 1;
      if (nextRound >= 2) {
        setS((prev) => ({ ...prev, clues: newClues, phase: 'results' }));
      } else {
        setS((prev) => ({
          ...prev,
          clues: newClues,
          currentRound: nextRound,
          currentPlayerInRound: 0,
          phase: 'round-transition',
        }));
      }
    }
  }

  function continueFromTransition() {
    update({ phase: 'round-input' });
  }

  function playAgain() {
    setS(INITIAL);
  }

  // ── Render helpers ────────────────────────────────────────────────────

  const isImpostor = (idx: number) => s.impostorIndex === idx;

  // ── Phase Screens ─────────────────────────────────────────────────────

  if (s.phase === 'setup') {
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6">
          <div className="text-center">
            <div className="text-5xl mb-3">🕵️</div>
            <h1 className="text-3xl font-bold tracking-tight">Impostor</h1>
            <p className="text-zinc-400 mt-2 text-sm">
              Two players know the word. One is the impostor.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Field
              label="Player 1 name"
              value={s.p1Name}
              onChange={(v) => update({ p1Name: v, error: '' })}
              placeholder="e.g. Alex"
            />
            <Field
              label="Player 2 name"
              value={s.p2Name}
              onChange={(v) => update({ p2Name: v, error: '' })}
              placeholder="e.g. Jordan"
            />
            <Field
              label="AI player name"
              value={s.aiName}
              onChange={(v) => update({ aiName: v })}
              placeholder="e.g. HAL-9000"
            />
          </div>

          {s.error && <p className="text-red-400 text-sm text-center">{s.error}</p>}

          <Btn onClick={startGame}>Start Game</Btn>

          <div className="text-zinc-500 text-xs text-center space-y-1">
            <p>• 3 players: you, your friend, and an AI</p>
            <p>• 2 rounds of one-word clues each</p>
            <p>• Can you identify the impostor?</p>
          </div>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'generating') {
    return (
      <Screen>
        <div className="text-center fade-up">
          <div className="text-5xl mb-4 pulse-slow">🤖</div>
          <p className="text-xl font-semibold">Generating secret word…</p>
          <p className="text-zinc-400 text-sm mt-2">The AI is picking a word</p>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'pass-to-0') {
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-1">Pass the phone to</p>
            <h2 className="text-4xl font-bold">{playerName(s, 0)}</h2>
          </div>
          <p className="text-zinc-400 text-sm">Make sure nobody else is looking!</p>
          <Btn onClick={() => showRole(0)}>I&apos;m ready 👀</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'show-role-0') {
    const imp = isImpostor(0);
    return (
      <Screen>
        <RoleReveal
          name={playerName(s, 0)}
          isImpostor={imp}
          word={s.secretWord}
          onDone={() => doneRevealing(0)}
        />
      </Screen>
    );
  }

  if (s.phase === 'pass-to-1') {
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-1">Pass the phone to</p>
            <h2 className="text-4xl font-bold">{playerName(s, 1)}</h2>
          </div>
          <p className="text-zinc-400 text-sm">Make sure nobody else is looking!</p>
          <Btn onClick={() => showRole(1)}>I&apos;m ready 👀</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'show-role-1') {
    const imp = isImpostor(1);
    return (
      <Screen>
        <RoleReveal
          name={playerName(s, 1)}
          isImpostor={imp}
          word={s.secretWord}
          onDone={() => doneRevealing(1)}
        />
      </Screen>
    );
  }

  if (s.phase === 'round-transition') {
    const isNewRound = s.currentPlayerInRound === 0;
    const currentName = playerName(s, s.currentPlayerInRound);
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6 text-center">
          {isNewRound && (
            <div className="bg-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-300 self-center">
              Round {s.currentRound + 1} of 2
            </div>
          )}
          <div className="text-5xl">📱</div>
          <div>
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-1">Pass the phone to</p>
            <h2 className="text-4xl font-bold">{currentName}</h2>
          </div>
          <p className="text-zinc-400 text-sm">It&apos;s their turn to give a clue</p>
          <Btn onClick={continueFromTransition}>I&apos;m ready</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-input') {
    const name = playerName(s, s.currentPlayerInRound);
    const isImp = isImpostor(s.currentPlayerInRound);
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-5">
          <div className="text-center">
            <div className="bg-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-300 inline-block mb-3">
              Round {s.currentRound + 1} of 2
            </div>
            <h2 className="text-2xl font-bold">{name}&apos;s turn</h2>
            {isImp ? (
              <p className="text-red-400 text-sm mt-1">You are the impostor — try to blend in!</p>
            ) : (
              <p className="text-zinc-400 text-sm mt-1">
                The word is{' '}
                <span className="font-bold text-white">{s.secretWord}</span>
              </p>
            )}
          </div>

          {/* Clues so far this round */}
          {s.clues[s.currentRound].length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Clues so far</p>
              {s.clues[s.currentRound].map((c, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-zinc-400">{c.name}</span>
                  <span className="font-medium">{c.clue}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <label className="text-sm text-zinc-400">Your one-word clue</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-violet-500 placeholder-zinc-600"
              placeholder="Enter one word…"
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

          <Btn onClick={submitClue}>Submit Clue</Btn>
        </div>
      </Screen>
    );
  }

  if (s.phase === 'round-ai') {
    return (
      <Screen>
        <div className="text-center fade-up flex flex-col items-center gap-4">
          <div className="text-5xl pulse-slow">🤖</div>
          <div>
            <h2 className="text-2xl font-bold">{s.aiName} is thinking…</h2>
            <p className="text-zinc-400 text-sm mt-1">Generating a clue</p>
          </div>
          {s.clues[s.currentRound].length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2 w-full max-w-xs mt-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Clues so far</p>
              {s.clues[s.currentRound].map((c, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-zinc-400">{c.name}</span>
                  <span className="font-medium">{c.clue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Screen>
    );
  }

  if (s.phase === 'results') {
    const impostorName = playerName(s, s.impostorIndex);
    const roundLabels = ['Round 1', 'Round 2'];
    return (
      <Screen>
        <div className="fade-up w-full max-w-sm mx-auto flex flex-col gap-6">
          <div className="text-center">
            <div className="text-5xl mb-3">🎭</div>
            <h1 className="text-3xl font-bold">Game Over!</h1>
          </div>

          {/* Secret word reveal */}
          <div className="bg-violet-900/40 border border-violet-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-300 text-sm uppercase tracking-widest mb-1">The secret word was</p>
            <p className="text-4xl font-black tracking-tight text-violet-300">{s.secretWord}</p>
          </div>

          {/* Impostor reveal */}
          <div className="bg-red-900/40 border border-red-700 rounded-2xl p-5 text-center">
            <p className="text-zinc-300 text-sm uppercase tracking-widest mb-1">The Impostor was</p>
            <p className="text-4xl font-black text-red-400">{impostorName}</p>
            {s.impostorIndex === 2 && (
              <p className="text-zinc-400 text-xs mt-1">The AI was faking it the whole time!</p>
            )}
            {s.impostorIndex !== 2 && (
              <p className="text-zinc-400 text-xs mt-1">They had no idea what the word was!</p>
            )}
          </div>

          {/* All clues */}
          <div className="flex flex-col gap-3">
            {roundLabels.map((label, ri) => (
              <div key={ri} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{label}</p>
                <div className="space-y-2">
                  {s.clues[ri].map((c, ci) => (
                    <div key={ci} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={c.isImpostor ? 'text-red-400 font-semibold' : 'text-zinc-300'}>
                          {c.name}
                          {c.isImpostor && ' 🕵️'}
                          {c.isAI && !c.isImpostor && ' 🤖'}
                        </span>
                      </div>
                      <span className="font-medium text-white">{c.clue}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Btn onClick={playAgain}>Play Again</Btn>
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

function Btn({ onClick, children, variant = 'primary' }: {
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

function Field({ label, value, onChange, placeholder }: {
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
        autoCapitalize="words"
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
            <p className="text-red-400 text-sm uppercase tracking-widest mb-2">You are</p>
            <p className="text-4xl font-black text-red-300">The Impostor!</p>
          </div>
          <p className="text-zinc-400 text-sm px-4">
            You don&apos;t know the secret word. Listen to the others&apos; clues and try to blend in!
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-6xl">🔑</div>
          <div className="bg-violet-900/40 border border-violet-700 rounded-2xl p-6 w-full">
            <p className="text-zinc-300 text-sm uppercase tracking-widest mb-2">The secret word is</p>
            <p className="text-4xl font-black text-violet-300">{word}</p>
          </div>
          <p className="text-zinc-400 text-sm px-4">
            Give one-word clues related to the word, but don&apos;t make it too obvious!
          </p>
        </div>
      )}

      <Btn onClick={onDone}>Got it — done!</Btn>
    </div>
  );
}
