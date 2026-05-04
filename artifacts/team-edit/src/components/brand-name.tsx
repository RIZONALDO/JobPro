export function BrandName({ name }: { name: string }) {
  const idx = name.indexOf("-");
  if (idx === -1) return <>{name}</>;
  const pre  = name.slice(0, idx);
  const post = name.slice(idx + 1);
  return (
    <>
      <span className="not-italic font-bold">{pre}</span>
      <span className="not-italic text-[hsl(var(--primary))]">{post}</span>
    </>
  );
}
