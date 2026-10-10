import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Trophy, X } from "lucide-react";
import type { LeaderboardEntry } from "@fog-train/shared";
import { api } from "../../api";
import { useAuthStore } from "../../store";

export function LeaderboardModal() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void api
      .leaderboard()
      .then((response) => {
        if (!cancelled) setEntries(response.entries);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "排行榜加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <>
      <button
        className="changelog-trigger"
        onClick={() => setOpen(true)}
        title="玩家排行榜"
        type="button"
      >
        <BarChart3 size={16} />
        排行榜
      </button>

      {open &&
        createPortal(
          <div
            className="leaderboard-overlay"
            role="presentation"
            onMouseDown={() => setOpen(false)}
          >
            <section
              aria-label="玩家排行榜"
              aria-modal="true"
              className="leaderboard-modal"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <header className="guide-header">
                <div>
                  <p className="eyebrow">已完成对局统计</p>
                  <h2>玩家排行榜</h2>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setOpen(false)}
                  title="关闭"
                  type="button"
                >
                  <X size={20} />
                </button>
              </header>

              {loading && <p className="muted leaderboard-state">正在统计乘客数据...</p>}
              {error && <p className="form-error leaderboard-state">{error}</p>}
              {!loading && !error && entries.length === 0 && (
                <div className="leaderboard-empty">
                  <Trophy size={34} />
                  <strong>还没有完成的正式对局</strong>
                  <span>完成一局后，玩家评分与角色胜率会出现在这里。</span>
                </div>
              )}
              {!loading && !error && entries.length > 0 && (
                <div className="leaderboard-table-wrap">
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th>排名</th>
                        <th>玩家</th>
                        <th>评分</th>
                        <th>最高胜率角色</th>
                        <th>场次</th>
                        <th>场均 KD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, index) => (
                        <tr
                          className={entry.userId === user?.id ? "is-self" : ""}
                          key={entry.userId}
                        >
                          <td>
                            <span className={`leaderboard-rank rank-${index + 1}`}>
                              {index + 1}
                            </span>
                          </td>
                          <td>
                            <strong>{entry.nickname}</strong>
                          </td>
                          <td>
                            <strong>{entry.rating.toFixed(2)}</strong>
                            <small>/ 10</small>
                          </td>
                          <td>
                            <span>{entry.bestRoleName}</span>
                            {entry.bestRoleId && (
                              <small>
                                {entry.bestRoleWinRate.toFixed(1)}% · {entry.bestRoleWins}/
                                {entry.bestRoleGames}
                              </small>
                            )}
                          </td>
                          <td>{entry.gamesPlayed}</td>
                          <td>{entry.averageKd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
