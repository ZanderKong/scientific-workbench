import { useEffect, useRef, type ReactNode } from "react";
export function Popover({
  anchor,
  close,
  children,
}: {
  anchor: DOMRect;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", keyboard);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="popover"
      role="menu"
      style={{
        left: Math.min(anchor.left, window.innerWidth - 224),
        top: anchor.bottom + 6,
      }}
    >
      {children}
    </div>
  );
}
