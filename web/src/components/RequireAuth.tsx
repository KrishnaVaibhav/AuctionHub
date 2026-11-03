import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/auth";

export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="text-sm text-stone-500">Loading...</p>;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <Outlet />;
}
