import { Outlet } from "react-router-dom";

export function PublicLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-3">
        <span className="font-bold">Insight2Redraft</span>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
