import Sidebar from "@/components/Sidebar";
import RoutingToggle from "@/components/RoutingToggle";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
      <RoutingToggle />
    </div>
  );
}
