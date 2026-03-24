import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/80",
        "before:absolute before:inset-0 before:animate-shimmer before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)] before:bg-[length:200%_100%]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
