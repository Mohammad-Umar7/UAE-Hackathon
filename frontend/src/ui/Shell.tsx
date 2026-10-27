"use client";

import dynamic from "next/dynamic";
import { useOps } from "@/store/ops";
import { AutoNav } from "./AutoNav";
import { SideNav } from "./SideNav";
import { StoryBar } from "./StoryBar";
import { TopBar } from "./TopBar";
import { Welcome } from "./Welcome";
import { Toasts } from "./common/Toasts";
import { Inspector } from "./agents/Inspector";

const CommandView = dynamic(() => import("./views/CommandView"), { ssr: false });
const TwinView = dynamic(() => import("./views/TwinView"), { ssr: false });
const WorkbenchView = dynamic(() => import("./views/WorkbenchView"), { ssr: false });
const AgentsView = dynamic(() => import("./views/AgentsView"), { ssr: false });
const TimelineView = dynamic(() => import("./views/TimelineView"), { ssr: false });
const LabView = dynamic(() => import("./views/LabView"), { ssr: false });
const EvidenceView = dynamic(() => import("./views/EvidenceView"), { ssr: false });
const ReplayView = dynamic(() => import("./views/ReplayView"), { ssr: false });
const Presentation = dynamic(() => import("./presentation/Presentation"), { ssr: false });

export function Shell() {
  const view = useOps((s) => s.view);
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <StoryBar />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="relative min-w-0 flex-1">
          {view === "command" && <CommandView />}
          {view === "twin" && <TwinView />}
          {view === "workbench" && <WorkbenchView />}
          {view === "agents" && <AgentsView />}
          {view === "timeline" && <TimelineView />}
          {view === "lab" && <LabView />}
          {view === "evidence" && <EvidenceView />}
          {view === "replay" && <ReplayView />}
        </main>
      </div>
      <Inspector />
      <Presentation />
      <Welcome />
      <Toasts />
      <AutoNav />
    </div>
  );
}
