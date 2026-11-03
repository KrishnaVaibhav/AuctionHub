import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Account } from "./pages/Account";
import { AuctionRoom } from "./pages/AuctionRoom";
import { HostDashboard } from "./pages/host/HostDashboard";
import { AuctionEditor } from "./pages/host/AuctionEditor";
import { NotFound } from "./pages/NotFound";
import { RequireAuth } from "./components/RequireAuth";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/login", element: <Login /> },
      { path: "/a/:id", element: <AuctionRoom /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/account", element: <Account /> },
          { path: "/host", element: <HostDashboard /> },
          { path: "/host/a/:id", element: <AuctionEditor /> },
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
