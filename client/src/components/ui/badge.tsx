import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground border-border/70",
        muted: "border-white/10 bg-white/[0.045] text-muted-foreground",
        success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
        warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
        danger: "border-red-400/25 bg-red-400/10 text-red-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
