/** Hitech Services round logo (files in public/: logo.png 512px, logo-160.png for small sizes) */
export default function Logo({ size = 40, className = '' }) {
  return (
    <img src={size > 80 ? './logo.png' : './logo-160.png'} alt="Hitech Services" width={size} height={size}
      className={`rounded-full flex-shrink-0 select-none shadow-[0_6px_20px_-6px_rgba(24,70,214,.55)] ring-1 ring-white/20 ${className}`}
      style={{ width: size, height: size }} draggable={false} />
  )
}
