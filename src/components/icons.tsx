/**
 * Icons — pacote de ícones SVG inline do Portal Aluno.
 * Traço consistente (stroke 2, arredondado), herdam a cor via currentColor.
 * Todos aceitam size e style; usar aria-hidden (decorativos) ou label via <title>.
 */
import React from 'react';

type IconProps = {
  size?: number;
  style?: React.CSSProperties;
  strokeWidth?: number;
};

function base(
  size: number,
  style: React.CSSProperties | undefined,
  strokeWidth: number,
  children: React.ReactNode,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconHome = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>);

export const IconIdCard = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><circle cx="8.5" cy="11" r="2" /><path d="M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4" /><path d="M14.5 9.5h4.5" /><path d="M14.5 13h4.5" /></>);

export const IconMapPin = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.6" /></>);

export const IconWallet = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2" /><path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5" /><path d="M21 15.5h-4a2 2 0 0 1 0-4h4Z" /></>);

export const IconMedal = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="12" cy="14.5" r="5.5" /><path d="m8.5 9.5-3-6.5h4L12 8l2.5-5h4l-3 6.5" /><path d="m12 12.2.9 1.9 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3Z" /></>);

export const IconCheck = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <path d="m4.5 12.5 5 5 10-11" />);

export const IconInfo = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.8v.4" /></>);

export const IconLock = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2.5" /></>);

export const IconTrash = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M4 7h16" /><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" /><path d="M6.5 7 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" /><path d="M10 11v6" /><path d="M14 11v6" /></>);

export const IconBag = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M5 8h14l-1 12.5a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 6 20.5Z" /><path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" /></>);

export const IconLink = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.8 4.7a4 4 0 0 1 5.7 5.7L16.6 12.3" /><path d="M13 17.5 11.2 19.3a4 4 0 0 1-5.7-5.7L7.4 11.7" /></>);

export const IconRefresh = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M20 11a8 8 0 1 0-1.2 6" /><path d="M20 5v6h-6" /></>);

export const IconPrinter = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M7 8V3.5h10V8" /><rect x="4" y="8" width="16" height="8.5" rx="2" /><path d="M7 13.5h10v7H7z" /></>);

export const IconPencil = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M14.5 5.5 18.5 9.5" /><path d="M4.5 19.5 5.5 15 16.7 3.8a1.6 1.6 0 0 1 2.3 0l1.2 1.2a1.6 1.6 0 0 1 0 2.3L9 18.5l-4.5 1Z" /></>);

export const IconChart = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M3.5 3.5v17h17" /><path d="m7.5 14.5 3.5-4 3 2.5 5-6" /></>);

export const IconCamera = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M4 8h2.5L8 5.5h8L17.5 8H20a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8Z" /><circle cx="12" cy="13.5" r="3.2" /></>);

export const IconFolder = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" /></>);

export const IconNote = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M6 3.5h9L19.5 8v12.5h-13Z" /><path d="M14.5 3.5V8.5h5" /><path d="M9 12.5h6.5" /><path d="M9 16h4.5" /></>);

export const IconMusic = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="7" cy="17.5" r="2.8" /><circle cx="17.5" cy="15.5" r="2.8" /><path d="M9.8 17.5V6.5L20.3 4v11.5" /><path d="M9.8 9.5 20.3 7" /></>);

export const IconGear = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8 13.9 5h2.8l.8 2.7 2.4 1.4-.6 2.9 1.4 2.5-2 2.1-.3 2.9-2.8.6L13.9 22 12 19.9 10.1 22l-1.7-1.9-2.8-.6-.3-2.9-2-2.1 1.4-2.5-.6-2.9L6.5 7.7 7.3 5h2.8Z" /></>);

export const IconDoc = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M7 3.5h7.5L19 8v12.5H7Z" /><path d="M14 3.5V8.5h5" /></>);

export const IconMenu = ({ size = 22, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M4 6.5h16" /><path d="M4 12h16" /><path d="M4 17.5h16" /></>);

export const IconX = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>);

export const IconLogout = ({ size = 18, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M14.5 8V5.5A1.5 1.5 0 0 0 13 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h7a1.5 1.5 0 0 0 1.5-1.5V16" /><path d="M10 12h10.5" /><path d="m17.5 8.5 3.5 3.5-3.5 3.5" /></>);

export const IconUser = ({ size = 18, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c1.4-3.4 4.1-5 7.5-5s6.1 1.6 7.5 5" /></>);

export const IconChevron = ({ size = 18, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <path d="m9 5.5 6.5 6.5L9 18.5" />);

export const IconBell = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M6 9.5a6 6 0 0 1 12 0c0 4.4 1.5 5.9 1.5 5.9h-15S6 13.9 6 9.5Z" /><path d="M10 18.8a2.1 2.1 0 0 0 4 0" /></>);

export const IconImage = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4.5 17.5 4.7-4.7 3.3 3 3-2.7 4 4.4" /></>);

export const IconEye = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>);

export const IconTrend = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M3.5 17.5 9 12l3.5 3 8-8.5" /><path d="M15.5 6.5h5v5" /></>);

export const IconFlame = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <path d="M12 21.5c-3.6 0-6-2.3-6-5.6 0-2.5 1.6-4.4 2.9-5.9.9-1 1.9-2.3 2.1-3.9 0 0 5 2.4 5 7 1-1 1.4-2.2 1.4-2.2.7 1.3.6 3 .6 4 0 3.9-2.4 6.6-6 6.6Z" />);

export const IconStar = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.9Z" />);

export const IconWarn = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M12 3.5 22 20H2Z" /><path d="M12 10v4.5" /><path d="M12 17.2v.1" /></>);

export const IconClock = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.4 2" /></>);

export const IconBerimbau = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><path d="M14 3 7 20" /><path d="M14 3c2.4.8 4 3 4 5.6 0 4.6-3.6 8.4-8.3 11.4" /><circle cx="6" cy="21" r="1.4" /></>);

export const IconMail = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m4 7.5 8 5.6 8-5.6" /></>);

export const IconSearch = ({ size = 20, style, strokeWidth = 2 }: IconProps) =>
  base(size, style, strokeWidth, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></>);
