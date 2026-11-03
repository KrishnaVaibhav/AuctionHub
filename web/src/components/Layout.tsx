import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/auth";
import { supabaseConfigured } from "../lib/supabase";
import { Avatar } from "./Avatar";
import { ThemeSegmented, ThemeToggle } from "./ThemeToggle";

export function Layout() {
  const { session, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const links = [
    { to: "/", label: "Auctions", end: true },
    ...(session
      ? [
          { to: "/me", label: "My bids" },
          { to: "/host", label: "Host" },
        ]
      : []),
  ];

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span>
              Auction<span className="text-brand-600">Hub</span>
            </span>
          </Link>

          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            <ThemeToggle />
            {session ? (
              <>
                <Link to="/account" className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-stone-100">
                  <Avatar name={profile?.display_name} url={profile?.avatar_url} size={32} />
                  <span className="max-w-32 truncate text-sm font-medium">{profile?.display_name ?? "Account"}</span>
                </Link>
                <button className="btn-ghost" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary">
                Sign in
              </Link>
            )}
          </div>

          <div className="ml-auto md:hidden">
            <ThemeToggle />
          </div>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-stone-100 md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="animate-rise border-t border-stone-200 bg-white px-4 pt-2 pb-4 md:hidden">
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                  {l.label}
                </NavLink>
              ))}
              {session && (
                <NavLink to="/account" className={navClass}>
                  Account
                </NavLink>
              )}
            </nav>
            <div className="mt-3 border-t border-stone-100 pt-3">
              <ThemeSegmented />
            </div>
            <div className="mt-3 border-t border-stone-100 pt-3">
              {session ? (
                <button className="btn-ghost w-full" onClick={() => void signOut()}>
                  Sign out
                </button>
              ) : (
                <Link to="/login" className="btn-primary w-full">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {!supabaseConfigured && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm text-snow">
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200/70 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-stone-500 sm:flex-row sm:px-6">
          <span>
            <span className="font-semibold text-stone-700">AuctionHub</span> · Live auctions, real-time bidding
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-stone-900">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-stone-900">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
