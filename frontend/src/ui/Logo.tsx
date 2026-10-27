import Image from "next/image";
import mark from "./skypact-logo.png";

/** SKYPACT mark: an aircraft climbing out on a curved track around the control tower. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="logo-mark inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <Image src={mark} alt="SKYPACT" width={size} height={size} loading="eager" unoptimized />
    </span>
  );
}
