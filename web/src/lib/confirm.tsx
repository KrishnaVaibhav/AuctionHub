import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Names the action, e.g. "Delete auction". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive: red button, and focus starts on Cancel. */
  danger?: boolean;
}

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby={opts.body ? "confirm-body" : undefined}
      onClose={() => onDone(ref.current?.returnValue === "ok")}
      onClick={(e) => {
        // Click on the backdrop cancels.
        if (e.target === ref.current) ref.current?.close("cancel");
      }}
      className="card m-auto w-[min(26rem,calc(100vw-2rem))] p-0 text-stone-900 backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form method="dialog" className="space-y-4 p-5">
        <h2 id="confirm-title" className="font-display text-lg font-extrabold tracking-tight">
          {opts.title}
        </h2>
        {opts.body && (
          <p id="confirm-body" className="text-sm text-stone-600">
            {opts.body}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button value="cancel" className="btn-ghost" autoFocus={opts.danger}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button value="ok" className={opts.danger ? "btn-danger" : "btn-accent"} autoFocus={!opts.danger}>
            {opts.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Promise-based replacement for window.confirm with action-named buttons. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <ConfirmDialog
        opts={opts}
        onDone={(ok) => {
          resolve(ok);
          setTimeout(() => {
            root.unmount();
            host.remove();
          });
        }}
      />,
    );
  });
}
