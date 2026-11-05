import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@fontsource/inter-tight/latin-800.css";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { RouteError } from "./components/RouteError";
import { initMonitoring } from "./lib/monitoring";
import { registerServiceWorker } from "./lib/notifications";
import { initI18n, useLanguage } from "./lib/i18n";

initMonitoring();
registerServiceWorker();

// Route-level code splitting: each page downloads only when visited.
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const AuctionRoom = lazy(() => import("./pages/AuctionRoom").then((m) => ({ default: m.AuctionRoom })));
const MyActivity = lazy(() => import("./pages/MyActivity").then((m) => ({ default: m.MyActivity })));
const HostDashboard = lazy(() => import("./pages/host/HostDashboard").then((m) => ({ default: m.HostDashboard })));
const AuctionEditor = lazy(() => import("./pages/host/AuctionEditor").then((m) => ({ default: m.AuctionEditor })));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const HostProfile = lazy(() => import("./pages/HostProfile").then((m) => ({ default: m.HostProfile })));
const Support = lazy(() => import("./pages/Support").then((m) => ({ default: m.Support })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const SeasonTable = lazy(() => import("./pages/SeasonTable").then((m) => ({ default: m.SeasonTable })));

const page = (el: ReactNode) => (
  <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-stone-100" />}>{el}</Suspense>
);

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/login", element: page(<Login />) },
      { path: "/a/:id", element: page(<AuctionRoom />) },
      { path: "/privacy", element: page(<Privacy />) },
      { path: "/terms", element: page(<Terms />) },
      { path: "/support", element: page(<Support />) },
      { path: "/u/:username", element: page(<HostProfile />) },
      { path: "/league/:id/season", element: page(<SeasonTable />) },
      {
        element: <RequireAuth />,
        children: [
          { path: "/me", element: page(<MyActivity />) },
          { path: "/account", element: page(<Account />) },
          { path: "/host", element: page(<HostDashboard />) },
          { path: "/host/a/:id", element: page(<AuctionEditor />) },
          { path: "/admin", element: page(<AdminDashboard />) },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

/** Remounts the routed UI when the language changes, so every t() call re-runs. */
function Localized() {
  const lang = useLanguage();
  return <RouterProvider key={lang} router={router} />;
}

void initI18n().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AuthProvider>
        <Localized />
      </AuthProvider>
    </StrictMode>,
  ),
);
