import type { ReactNode } from 'react';

const ICONS = {
  compose: <><path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13" /><path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12.3 14.5 9 15.4l.9-3.3z" /></>,
  more: <><circle cx="12" cy="12" r="9" /><circle cx="7.8" cy="12" r=".6" className="dot" /><circle cx="12" cy="12" r=".6" className="dot" /><circle cx="16.2" cy="12" r=".6" className="dot" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></>,
  back: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  trash: <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.2 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.8a1.5 1.5 0 0 0 1.5-1.4l.9-12.6M10 10.5v6M14 10.5v6" />,
  pin: <path d="M9 3.5h6M10 3.5v6l-3.5 4h11L14 9.5v-6M12 13.5v7" />,
  heading: <path d="M6.5 5v14M17.5 5v14M6.5 12h11" />,
  bold: <path d="M7.5 5h5.25a3.5 3.5 0 0 1 0 7H7.5zM7.5 12h6a3.5 3.5 0 0 1 0 7h-6z" strokeWidth={2.3} />,
  italic: <path d="M10.5 5h7M6.5 19h7M14 5l-4 14" />,
  quote: <path d="M5 5.5v13M9.5 7.5h9.5M9.5 12h9.5M9.5 16.5h6" />,
  code: <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />,
  link: <path d="M10.5 13.5a3.75 3.75 0 0 0 5.3 0l3-3a3.75 3.75 0 0 0-5.3-5.3l-1.2 1.2M13.5 10.5a3.75 3.75 0 0 0-5.3 0l-3 3a3.75 3.75 0 0 0 5.3 5.3l1.2-1.2" />,
  ordered: <><path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H20" /><path d="M4 4.8 5.4 4v5" strokeWidth={1.4} /><path d="M3.8 13.4a1.4 1.4 0 0 1 2.7.4c0 1-2.7 2.3-2.7 3.7h2.8" strokeWidth={1.4} /></>,
  bullet: <><path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" /><circle cx="5" cy="6.5" r=".9" className="dot" /><circle cx="5" cy="12" r=".9" className="dot" /><circle cx="5" cy="17.5" r=".9" className="dot" /></>,
  task: <><rect x="3.5" y="4" width="5.5" height="5.5" rx="1.3" /><path d="m4.9 6.8 1.1 1.1 1.8-2.1" strokeWidth={1.4} /><rect x="3.5" y="14.5" width="5.5" height="5.5" rx="1.3" /><path d="M12 6.8h8.5M12 17.2h8.5" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M5 19.5h14" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}
