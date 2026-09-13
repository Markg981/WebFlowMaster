import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // A disabled button drops to the muted surface rather than to 50% of its own colour.
  // A half-opacity blue button reads as a button mid-request — the same thing a spinner
  // means — when what it actually says is "not available yet". Losing the colour entirely
  // says that instead, and keeps the label at a readable contrast while it does.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // A disabled solid button drops to the muted surface rather than to 50% of its own
      // colour. A half-opacity blue button reads as a button mid-request — the same thing a
      // spinner means — when what it actually says is "not available yet". Losing the colour
      // says that instead, and keeps the label at a readable contrast while it does.
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-transparent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:bg-muted",
        ghost: "hover:bg-accent hover:text-accent-foreground disabled:bg-transparent",
        link: "text-primary underline-offset-4 hover:underline disabled:no-underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
