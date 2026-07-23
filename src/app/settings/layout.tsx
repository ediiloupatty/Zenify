import Sidebar from "@/components/Sidebar";
import DynamicBackground from "@/components/DynamicBackground";
import QueueAwareMain from "@/components/QueueAwareMain";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-screen font-sans overflow-hidden relative"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <DynamicBackground />
      <Sidebar />
      <QueueAwareMain className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </QueueAwareMain>
    </div>
  );
}
