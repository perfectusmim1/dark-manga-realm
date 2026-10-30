import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground focus:text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-secondary-foreground focus:text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground",
        outline: "border-border text-foreground hover:bg-secondary/70 hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
