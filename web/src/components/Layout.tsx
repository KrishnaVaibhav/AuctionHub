import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../lib/auth";
import { supabaseConfigured } from "../lib/supabase";

export function Layout() {
  const { session, profile, signOut } = useAuth();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900"}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            AuctionHub
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Auctions
            </NavLink>
            {session ? (
              <>
                <NavLink to="/host" className={navClass}>
                  Host
                </NavLink>
                <NavLink to="/account" className={navClass}>
                  {profile?.display_name ?? "Account"}
                </NavLink>
                <button className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-900" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary ml-2">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {!supabaseConfigured && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
        AuctionHub. Live auctions with real-time bidding.
      </footer>
    </div>
  );
}
