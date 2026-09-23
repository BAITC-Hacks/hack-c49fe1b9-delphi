import { cloneElement, isValidElement, type ComponentPropsWithoutRef, type ReactElement } from "react";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  asChild?: boolean;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline" | "ghost";
};

export function Button({ asChild = false, size = "default", variant = "default", className = "", children, ...props }: ButtonProps) {
  const classes = `button button--${variant} button-size--${size} ${className}`;
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, { ...props, className: `${classes} ${child.props.className || ""}` });
  }
  return <button type="button" {...props} className={classes}>{children}</button>;
}
