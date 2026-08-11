import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LeagueDetailPage } from "@/pages/LeagueDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFound } from "@/pages/NotFound";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "leagues/:id", element: <LeagueDetailPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "admin",
    element: <ProtectedRoute />,
    children: [{ element: <AdminLayout />, children: [{ index: true, element: <p>Admin home</p> }] }],
  },
]);
