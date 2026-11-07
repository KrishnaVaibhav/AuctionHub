import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { DotsThreeCircleIcon, GavelIcon, HandCoinsIcon, SignInIcon, StorefrontIcon, UserCircleIcon, XIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { Avatar } from "./Avatar";
import { ThemeSegmented, ThemeToggle } from "./ThemeToggle";
import { useIsAdmin } from "../lib/admin";
import { NotificationBell } from "./NotificationBell";
import { LanguagePicker } from "./LanguagePicker";
import { t } from "../lib/i18n";
import { LiquidGlass } from "./Glass";

export function Layout() {
  const { session, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Claim a pending invite once signed in (the server ignores it for older accounts).
  useEffect(() => {
    const ref = localStorage.getItem("ref");
    if (!session || !ref) return;
    localStorage.removeItem("ref");
    void supabase.rpc("claim_referral", { p_username: ref });
  }, [session]);

  // Phone tab bar: top-level places only. Hidden where a page brings its own bottom bar.
  const tabs: { to: string; label: string; icon: Icon; end?: boolean }[] = [
    { to: "/", label: t("Auctions"), icon: GavelIcon, end: true },
    ...(session
      ? [
          { to: "/me", label: t("My bids"), icon: HandCoinsIcon },
          { to: "/host", label: t("Host"), icon: StorefrontIcon },
          { to: "/account", label: t("Account"), icon: UserCircleIcon },
        ]
      : [{ to: "/login", label: t("Sign in"), icon: SignInIcon }]),
  ];
  const showTabBar = !/^\/(a|host\/a)\//.test(location.pathname);

  const links = [
    { to: "/", label: t("Auctions"), end: true },
    ...(session
      ? [
          { to: "/me", label: t("My bids") },
          { to: "/host", label: t("Host") },
          ...(isAdmin ? [{ to: "/admin", label: t("Admin") }] : []),
        ]
      : []),
  ];

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-3.5 py-2 text-sm font-medium transition duration-300 ${
      isActive
        ? "bg-white/90 text-stone-900 shadow-[0_1px_3px_rgb(41_37_36/0.14)] dark:bg-snow/10"
        : "text-stone-600 hover:bg-stone-900/5 hover:text-stone-900 dark:hover:bg-snow/5"
    }`;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Floating glass navigation: content scrolls underneath it. */}
      <header className="sticky top-0 z-30 px-3 sm:px-6" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <LiquidGlass className="mx-auto flex h-14 max-w-7xl items-center gap-2 rounded-full pr-2 pl-3 sm:pl-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span>
              Auction<span className="text-brand-600">Hub</span>
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-1 md:flex">
            <NotificationBell />
            <LanguagePicker />
            <ThemeToggle />
            {session ? (
              <>
                <Link to="/account" className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition hover:bg-stone-900/5 dark:hover:bg-snow/5">
                  <Avatar name={profile?.display_name} url={profile?.avatar_url} size={32} />
                  <span className="max-w-32 truncate text-sm font-medium">{profile?.display_name ?? t("Account")}</span>
                </Link>
                <button className="btn-ghost" onClick={() => void signOut()}>
                  {t("Sign out")}
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary">
                {t("Sign in")}
              </Link>
            )}
          </div>

          <div className="ml-auto flex items-center md:hidden">
            <NotificationBell />
            <ThemeToggle />
            <button className="btn-icon" onClick={() => setMenuOpen((o) => !o)} aria-label={t("Menu")} aria-expanded={menuOpen}>
              {menuOpen ? <XIcon size={22} weight="bold" aria-hidden="true" /> : <DotsThreeCircleIcon size={24} aria-hidden="true" />}
            </button>
          </div>
        </LiquidGlass>

        {menuOpen && (
          <LiquidGlass className="thick mx-auto mt-2 max-w-7xl animate-rise rounded-[28px] p-3 md:hidden">
            {isAdmin && (
              <nav className="mb-3 flex flex-col gap-1 border-b border-stone-900/5 pb-3 dark:border-snow/5">
                <NavLink to="/admin" className={navClass}>
                  {t("Admin")}
                </NavLink>
              </nav>
            )}
            <div className="space-y-2">
              <ThemeSegmented />
              <LanguagePicker full />
            </div>
            <div className="mt-3 border-t border-stone-900/5 pt-3 dark:border-snow/5">
              {session ? (
                <button className="btn-ghost w-full" onClick={() => void signOut()}>
                  {t("Sign out")}
                </button>
              ) : (
                <Link to="/login" className="btn-primary w-full">
                  {t("Sign in")}
                </Link>
              )}
            </div>
          </LiquidGlass>
        )}
      </header>

      {!supabaseConfigured && (
        <div className="mx-3 mt-3 rounded-full bg-red-600 px-4 py-2 text-center text-sm text-snow sm:mx-6">
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </div>
      )}

      <main className={`mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8`}>
        <Outlet />
      </main>

      {showTabBar && (
        <nav
          aria-label={t("Main")}
          className="fixed inset-x-0 bottom-0 z-30 px-3 md:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <LiquidGlass className="mx-auto flex max-w-md items-stretch justify-around gap-1 rounded-full p-1.5">
            {tabs.map(({ to, label, icon: TabIcon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-semibold transition duration-300 active:scale-95 ${
                    isActive ? "bg-white/80 text-brand-700 shadow-[0_1px_3px_rgb(41_37_36/0.12)] dark:bg-snow/10" : "text-stone-600"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <TabIcon size={22} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
                    <span className="max-w-full truncate">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </LiquidGlass>
        </nav>
      )}

      <footer className={`border-t border-stone-900/[0.06] py-8 dark:border-snow/[0.06] ${showTabBar ? "pb-28 md:pb-8" : ""}`}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-stone-500 sm:flex-row sm:px-6">
          <span>
            <span className="font-semibold text-stone-700">AuctionHub</span> · {t("Live auctions, real-time bidding")}
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-stone-900">
              {t("Privacy")}
            </Link>
            <Link to="/terms" className="hover:text-stone-900">
              {t("Terms")}
            </Link>
            <Link to="/support" className="hover:text-stone-900">
              {t("Support")}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
