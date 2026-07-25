import type { ReactNode } from 'react'

export type ContextMenuActionId =
  | 'addElement'
  | 'addNote'
  | 'delete'
  | 'hideInThisView'
  | 'showHidden'

export function getContextMenuIcon(action: ContextMenuActionId): ReactNode {
  switch (action) {
    case 'addElement':
      // Plus inside rounded square
      return (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="w-4 h-4"
        >
          <rect
            x="3"
            y="3"
            width="14"
            height="14"
            rx="3"
            ry="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M10 6v8M6 10h8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'addNote':
      // Speech bubble / note
      return (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="w-4 h-4"
        >
          <path
            d="M4 4.5h9.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H9l-3 2v-2H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M6.5 8h5M6.5 10.5H11"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'delete':
      // Trash can
      return (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="w-4 h-4"
        >
          <path
            d="M7.5 4h5M4 5.5h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect
            x="6"
            y="5.5"
            width="8"
            height="9.5"
            rx="1.5"
            ry="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M9 8.5v5M11 8.5v5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'hideInThisView':
      // Eye with strike-through
      return (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="w-4 h-4"
        >
          <path
            d="M3 4.5 17 15.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M4 10c1.5-2.5 3.5-4 6-4 1.1 0 2.1.3 3 .8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M16 11.5c-1.3 2.3-3.3 3.8-6 3.8-1.2 0-2.3-.3-3.3-.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'showHidden':
      // Eye
      return (
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="w-4 h-4"
        >
          <path
            d="M3 10c1.8-3 3.9-4.5 7-4.5S15.2 7 17 10c-1.8 3-3.9 4.5-7 4.5S4.8 13 3 10Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle
            cx="10"
            cy="10"
            r="2.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      )
    default:
      return null
  }
}

