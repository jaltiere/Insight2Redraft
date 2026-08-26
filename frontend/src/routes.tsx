import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { AccountDetailPage } from "@/pages/admin/AccountDetailPage";
import { AccountsListPage } from "@/pages/admin/AccountsListPage";
import { AdminHome } from "@/pages/admin/AdminHome";
import { BracketAdminPage } from "@/pages/admin/BracketAdminPage";
import { OwnersListPage } from "@/pages/admin/OwnersListPage";
import { OwnerDetailPage } from "@/pages/admin/OwnerDetailPage";
import { MappingPage } from "@/pages/admin/MappingPage";
import { SeasonDetailPage } from "@/pages/admin/SeasonDetailPage";
import { SeasonsListPage } from "@/pages/admin/SeasonsListPage";
import { PublicLayout } from "@/layouts/PublicLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LeagueDetailPage } from "@/pages/LeagueDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFound } from "@/pages/NotFound";
import { OwnerProfilePage } from "@/pages/OwnerProfilePage";
import { TeamDetailPage } from "@/pages/TeamDetailPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "leagues/:id", element: <LeagueDetailPage /> },
      { path: "teams/:id", element: <TeamDetailPage /> },
      { path: "owners/:id", element: <OwnerProfilePage /> },
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
          { path: "leagues/:id/mapping", element: <MappingPage /> },
          { path: "owners", element: <OwnersListPage /> },
          { path: "owners/:id", element: <OwnerDetailPage /> },
          {
            element: <ProtectedRoute requireRole="super_admin" />,
            children: [
              { path: "accounts", element: <AccountsListPage /> },
              { path: "accounts/:id", element: <AccountDetailPage /> },
              { path: "seasons/:id/bracket", element: <BracketAdminPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
