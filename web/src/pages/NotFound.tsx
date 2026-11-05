import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="aurora mx-auto flex max-w-2xl flex-col items-center rounded-[36px] px-6 py-24 text-center">
      <p className="enter font-display text-7xl font-extrabold tracking-tighter text-brand-600 tabular-nums">404</p>
      <h1 className="enter page-title mt-3" style={{ ["--i" as string]: 1 }}>Page not found</h1>
      <p className="enter page-sub" style={{ ["--i" as string]: 2 }}>The link may be old, or the auction was removed.</p>
      <Link to="/" className="btn-accent enter mt-8" style={{ ["--i" as string]: 3 }}>
        Back to auctions
      </Link>
    </div>
  );
}
