import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { AdminHome } from "@/pages/admin/AdminHome";
import { AdminSectionStub } from "@/pages/admin/AdminSectionStub";
import { OwnersListPage } from "@/pages/admin/OwnersListPage";
import { SeasonDetailPage } from "@/pages/admin/SeasonDetailPage";
import { SeasonsListPage } from "@/pages/admin/SeasonsListPage";
import { PublicLayout } from "@/layouts/PublicLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LeagueDetailPage } from "@/pages/LeagueDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFound } from "@/pages/NotFound";
import { TeamDetailPage } from "@/pages/TeamDetailPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "leagues/:id", element: <LeagueDetailPage /> },
      { path: "teams/:id", element: <TeamDetailPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "admin",
    element: <ProtectedRoute />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminHome /> },
          { path: "seasons", element: <SeasonsListPage /> },
          { path: "seasons/:id", element: <SeasonDetailPage /> },
          { path: "owners", element: <OwnersListPage /> },
          {
            element: <ProtectedRoute requireRole="super_admin" />,
            children: [{ path: "accounts", element: <AdminSectionStub title="Accounts" /> }],
          },
        ],
      },
    ],
  },
]);
