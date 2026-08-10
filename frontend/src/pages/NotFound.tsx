import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That page doesn't exist (yet).</p>
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        Back to seasons
      </Link>
    </div>
  );
}
