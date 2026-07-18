import type { Metadata } from "next";
import { WeaponGridLab } from "./WeaponGridLab";

export const metadata: Metadata = {
  title: "Weapon Grid Lab",
  description:
    "A local test environment for growing weapon grids and geometry-driven item structures.",
};

export default function Home() {
  return <WeaponGridLab />;
}

