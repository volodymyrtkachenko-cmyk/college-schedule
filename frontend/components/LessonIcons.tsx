import type { SVGProps } from "react";

function Icon({ children, strokeWidth = 2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function EditIcon() {
  return (
    <Icon>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Icon>
  );
}

export function MoveIcon() {
  return (
    <Icon>
      <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" />
      <polyline points="19 9 22 12 19 15" /><polyline points="9 19 12 22 15 19" />
      <line x1="2" x2="22" y1="12" y2="12" /><line x1="12" x2="12" y1="2" y2="22" />
    </Icon>
  );
}
