import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  title,
  children,
  footer,
  close,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  close: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      container.current?.querySelector<HTMLElement>("[data-initial-focus]") ??
      container.current?.querySelector<HTMLElement>(
        "input, button, select, textarea",
      );
    initial?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) ?? [],
      );
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={container}
      >
        <div className="modalHeader">
          <b>{title}</b>
          <button className="close" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modalBody">{children}</div>
        {footer && <div className="modalFooter">{footer}</div>}
      </div>
    </div>
  );
}
