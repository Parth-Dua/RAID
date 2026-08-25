import { useGame } from "../state/GameProvider.js";

export function ErrorToasts() {
  const { errors, dismissError } = useGame();
  if (errors.length === 0) return null;
  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col gap-2 max-w-sm">
      {errors.map((e) => (
        <div
          key={e.id}
          className="bg-ink-800 border border-sev-1/50 text-sm text-ink-100 rounded-md px-3 py-2 shadow-lg flex items-start gap-2"
        >
          <span className="text-sev-1 mt-0.5">&#9888;</span>
          <span className="flex-1">{e.message}</span>
          <button onClick={() => dismissError(e.id)} className="text-ink-400 hover:text-ink-100">
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
