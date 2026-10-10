import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, History, LockKeyhole, LogOut, Plus, TrainFront } from "lucide-react";
import {
  DEFAULT_MAP_ID,
  MAP_REGISTRY,
  type MapId,
} from "@fog-train/shared";
import { api } from "../../api";
import { useAuthStore } from "../../store";
import { GameGuide } from "../guide/GameGuide";
import { AmbientFog } from "../../components/AmbientFog";
import { RoleIcon } from "../../components/RoleIcon";
import { ChangelogModal } from "../changelog/ChangelogModal";
import { LeaderboardModal } from "../leaderboard/LeaderboardModal";

export function HomePage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedMapId, setSelectedMapId] = useState<MapId>(DEFAULT_MAP_ID);
  const [recentRoom, setRecentRoom] = useState<{ roomCode: string } | null>(null);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fog-train:last-room");
      if (!saved) return;
      const parsed = JSON.parse(saved) as { roomCode?: string };
      if (parsed.roomCode) setRecentRoom({ roomCode: parsed.roomCode });
    } catch {
      localStorage.removeItem("fog-train:last-room");
    }
  }, []);

  const createRoom = async () => {
    setBusy(true);
    setError("");
    try {
      const room = await api.createRoom(selectedMapId);
      navigate(`/room/${room.roomId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    navigate(`/join/${code.trim().toUpperCase()}`);
  };

  const returnToRoom = async () => {
    if (!recentRoom) return;
    setBusy(true);
    setError("");
    try {
      const room = await api.joinRoom(recentRoom.roomCode);
      navigate(`/room/${room.roomId}`);
    } catch {
      localStorage.removeItem("fog-train:last-room");
      setRecentRoom(null);
      setError("该房间已经关闭");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home-shell">
      <AmbientFog />
      <header className="topbar">
        <div className="brand">
          <TrainFront size={22} />
          <span className="brand-copy">
            <strong>MistyTrain.com</strong>
            <small>雾中列车</small>
          </span>
        </div>
        <div className="user-strip">
          <span>{user?.nickname}</span>
          <LeaderboardModal />
          <ChangelogModal />
          <button className="icon-button" onClick={() => void logout()} title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="home-hero">
        <p className="eyebrow">2 至 8 人实时盲棋</p>
        <h1>在看不见彼此的列车里，活到最后。</h1>
        <p>创建房间邀请朋友，或输入房间码登车。</p>
        {recentRoom && (
          <button className="secondary recent-room-button" onClick={() => void returnToRoom()}>
            <History size={18} />
            回到房间 {recentRoom.roomCode}
          </button>
        )}
        <div className="home-guide-entry">
          <GameGuide />
        </div>
      </section>

      <section className="home-actions">
        <article className="action-panel create-panel">
          <div className="panel-icon">
            <Plus size={24} />
          </div>
          <h2>开一局</h2>
          <p>生成房间码和邀请链接，等其他人准备后开始。</p>
          <div className="map-options" aria-label="选择地图">
            {Object.values(MAP_REGISTRY)
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((map) => (
                <button
                  className={`map-option ${selectedMapId === map.id ? "selected" : ""} ${map.available ? "" : "locked"}`}
                  disabled={!map.available}
                  key={map.id}
                  onClick={() => setSelectedMapId(map.id)}
                  type="button"
                >
                  <RoleIcon icon={map.icon} symbol="图" />
                  <span>
                    <strong>{map.name}</strong>
                    <small>{map.description}</small>
                  </span>
                  {!map.available && (
                    <em>
                      <LockKeyhole size={12} />
                      未开放
                    </em>
                  )}
                </button>
              ))}
          </div>
          <button className="primary" disabled={busy} onClick={() => void createRoom()}>
            创建房间
            <ArrowRight size={18} />
          </button>
        </article>

        <article className="action-panel">
          <div className="panel-icon">
            <TrainFront size={24} />
          </div>
          <h2>加入列车</h2>
          <form className="join-form" onSubmit={join}>
            <input
              aria-label="房间码"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="输入 6 位房间码"
              value={code}
            />
            <button className="secondary" type="submit">
              加入
            </button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </article>
      </section>
    </main>
  );
}
