export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-muted/30 min-h-dvh px-4 py-8">{children}</div>;
}
