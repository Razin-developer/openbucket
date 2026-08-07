import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ob-empty-state">
      <svg className="ob-empty-mark" width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#171717" />
        <path d="M8 10.5h16l-1.6 12.2a3 3 0 0 1-3 2.6h-6.8a3 3 0 0 1-3-2.6L8 10.5Z" fill="#fff" />
        <path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 7 8.5Z" fill="#fff" />
        <path d="M12 15h8M12.7 19h6.6" stroke="#171717" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
