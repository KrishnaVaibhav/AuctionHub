import { useRouteError } from "react-router";

/** Shown instead of a blank screen if a page crashes. */
export function RouteError() {
  const err = useRouteError();
  console.error(err);
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="font-display text-2xl font-bold">Something went wrong</p>
      <p className="mt-2 text-sm text-stone-500">The page hit an unexpected error. Reloading usually fixes it.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <a href="/" className="btn-ghost">
          Home
        </a>
      </div>
    </div>
  );
}
