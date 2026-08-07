import { useSeasons } from "@/features/useSeasons";

export function SeasonsPage() {
  const { data, isPending, isError } = useSeasons();

  if (isPending) return <p>Loading seasons…</p>;
  if (isError) return <p>Couldn't load seasons.</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold">Seasons</h2>
      <ul>
        {data.map((s) => (
          <li key={s.id}>
            <span>{s.year}</span> — {s.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
