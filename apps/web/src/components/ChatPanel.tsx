import { FormEvent, useEffect, useRef, useState } from "react";
import { useGame } from "../state/GameProvider.js";

export function ChatPanel() {
  const { gameSnapshot, myPlayerId, actions } = useGame();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [gameSnapshot?.chat.length]);

  if (!gameSnapshot) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await actions.sendChat(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto scrollbar-thin -mx-3 px-3 pb-2">
        {gameSnapshot.chat.map((m) => (
          <div key={m.id} className={m.kind === "system" ? "text-[11px] text-ink-500 italic" : "text-xs"}>
            {m.kind === "player" && (
              <span className={`font-medium mr-1.5 ${m.authorId === myPlayerId ? "text-accent" : "text-ink-300"}`}>
                {m.authorName}:
              </span>
            )}
            <span className="text-ink-200">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="flex gap-1.5 pt-2 border-t border-ink-800 shrink-0">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the team..."
          maxLength={500}
          className="flex-1 bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button disabled={busy || !text.trim()} className="text-xs px-3 py-1.5 bg-ink-700 rounded disabled:opacity-40">
          Send
        </button>
      </form>
    </div>
  );
}
