import { Zap } from "lucide-react";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <span className="font-display text-2xl leading-none">TJ</span>
        <Zap className="absolute -right-1 -top-1 h-3 w-3 fill-primary text-primary" />
      </div>
      <div className="leading-tight">
        <div className={`font-display text-lg ${light ? "text-white" : "text-foreground"}`}>THE JOHN</div>
        <div className="text-[10px] tracking-[0.3em] text-primary">— FITNESS —</div>
      </div>
    </div>
  );
}
