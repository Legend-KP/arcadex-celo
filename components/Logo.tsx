const LOGO_SRC = "/thumbnails/arcadeX.webp";

interface LogoProps {
  variant?: "header" | "loading" | "login";
}

export default function Logo({ variant = "header" }: LogoProps) {
  return (
    <span className={`logo-wrap logo-wrap--${variant}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_SRC} alt="ArcadeX" className="logo-img" />
    </span>
  );
}
