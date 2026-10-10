import { useState } from "react";
import { createPortal } from "react-dom";
import { ScrollText, X } from "lucide-react";
import { CHANGELOG, CURRENT_VERSION } from "./changelog";

export function ChangelogModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="changelog-trigger"
        onClick={() => setOpen(true)}
        title="更新日志"
        type="button"
      >
        <ScrollText size={16} />
        更新日志
        <span>v{CURRENT_VERSION}</span>
      </button>

      {open &&
        createPortal(
          <div className="changelog-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
            <section
              aria-label="更新日志"
              aria-modal="true"
              className="changelog-modal"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <header className="guide-header">
                <div>
                  <p className="eyebrow">当前版本 v{CURRENT_VERSION}</p>
                  <h2>更新日志</h2>
                </div>
                <button className="icon-button" onClick={() => setOpen(false)} title="关闭" type="button">
                  <X size={20} />
                </button>
              </header>
              <div className="changelog-list">
                {CHANGELOG.map((entry) => (
                  <article className="changelog-entry" key={entry.version}>
                    <div className="changelog-version">
                      <strong>v{entry.version}</strong>
                      <span className={`change-kind kind-${entry.kind}`}>{entry.kind}</span>
                    </div>
                    <ul>
                      {entry.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
