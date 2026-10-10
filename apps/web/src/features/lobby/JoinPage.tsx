import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoaderCircle, TrainFront } from "lucide-react";
import { api } from "../../api";

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .joinRoom(code)
      .then((room) => {
        if (!cancelled) navigate(`/room/${room.roomId}`, { replace: true });
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "加入失败");
      });
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <main className="center-page">
      <div className="join-state">
        <TrainFront size={34} />
        {error ? (
          <>
            <h1>无法登上列车</h1>
            <p>{error}</p>
            <button className="primary" onClick={() => navigate("/")}>
              返回首页
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={30} />
            <p>正在连接房间 {code.toUpperCase()}</p>
          </>
        )}
      </div>
    </main>
  );
}
