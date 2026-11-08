"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, GearIcon, HomeIcon } from "./icons";

const TABS = [
  { href: "/", label: "Today", Icon: HomeIcon },
  { href: "/progress", label: "Progress", Icon: ChartIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="tab" aria-current={path === href ? "page" : undefined}>
          <Icon size={22} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
