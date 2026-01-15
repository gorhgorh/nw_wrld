import React from "react";

type ButtonStyleType = "primary" | "secondary";

type ButtonOwnProps = {
  onClick?: React.MouseEventHandler;
  children?: React.ReactNode;
  title?: string;
  className?: string;
  as?: React.ElementType;
  type?: ButtonStyleType;
  icon?: React.ReactNode;
  disabled?: boolean;
  htmlType?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
};

export const Button = ({
  onClick,
  children,
  title,
  className = "",
  as: Component = "div",
  type = "primary",
  icon,
  disabled = false,
  htmlType = "button",
  ...props
}: ButtonOwnProps & Record<string, unknown>) => {
  const baseClasses = "relative flex uppercase text-[11px] font-mono";

  const typeClasses =
    type === "secondary" ? "text-red-500/50" : "text-neutral-300";

  const disabledClasses = disabled
    ? "opacity-30 cursor-not-allowed"
    : "cursor-pointer";

  const handleClick: React.MouseEventHandler = (e) => {
    if (disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <Component
      onClick={handleClick}
      className={`${baseClasses} ${typeClasses} ${disabledClasses} ${className}`}
      title={title}
      aria-disabled={disabled || undefined}
      disabled={Component === "button" ? disabled : undefined}
      type={Component === "button" ? htmlType : undefined}
      {...props}
    >
      <span className="flex items-center gap-1.5">
        {icon && <span className="flex-shrink-0 opacity-75">{icon}</span>}
        {children && <span>{children}</span>}
      </span>
    </Component>
  );
};

