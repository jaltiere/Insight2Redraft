import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { LoginPage } from "@/pages/LoginPage";
import { NotFound } from "@/pages/NotFound";
import { SeasonsPage } from "@/pages/SeasonsPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <SeasonsPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "admin",
    element: <ProtectedRoute />,
    children: [{ element: <AdminLayout />, children: [{ index: true, element: <p>Admin home</p> }] }],
  },
]);
