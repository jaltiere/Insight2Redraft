import { createBrowserRouter } from "react-router-dom";
import { PublicLayout } from "@/layouts/PublicLayout";
import { SeasonsPage } from "@/pages/SeasonsPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [{ index: true, element: <SeasonsPage /> }],
  },
]);
