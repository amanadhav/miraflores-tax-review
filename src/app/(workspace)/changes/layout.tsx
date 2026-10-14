import { ChangesNav } from "@/components/changes-nav";

export default function ChangesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ChangesNav />
      {children}
    </div>
  );
}
