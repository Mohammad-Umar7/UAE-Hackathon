import { Logo } from "./Logo";

export function Splash({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4 fade-in">
        <Logo size={44} />
        <div className="text-center">
          <div className="text-[15px] font-semibold tracking-tight text-ink">SKYPACT</div>
          <div className="text-muted mt-1">{label}</div>
          {detail ? <div className="mono text-faint mt-1 text-[11px]">{detail}</div> : null}
        </div>
        <div className="h-[2px] w-40 overflow-hidden rounded bg-line">
          <div className="h-full w-1/3 bg-navy" style={{ animation: "slide 1.1s ease-in-out infinite" }} />
        </div>
        <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
      </div>
    </div>
  );
}
