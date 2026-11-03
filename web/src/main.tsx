import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";

// Route-level code splitting: each page downloads only when visited.
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const AuctionRoom = lazy(() => import("./pages/AuctionRoom").then((m) => ({ default: m.AuctionRoom })));
const MyActivity = lazy(() => import("./pages/MyActivity").then((m) => ({ default: m.MyActivity })));
const HostDashboard = lazy(() => import("./pages/host/HostDashboard").then((m) => ({ default: m.HostDashboard })));
const AuctionEditor = lazy(() => import("./pages/host/AuctionEditor").then((m) => ({ default: m.AuctionEditor })));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Support = lazy(() => import("./pages/Support").then((m) => ({ default: m.Support })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));

const page = (el: ReactNode) => (
  <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-stone-100" />}>{el}</Suspense>
);

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/login", element: page(<Login />) },
      { path: "/a/:id", element: page(<AuctionRoom />) },
      { path: "/privacy", element: page(<Privacy />) },
      { path: "/terms", element: page(<Terms />) },
      { path: "/support", element: page(<Support />) },
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
