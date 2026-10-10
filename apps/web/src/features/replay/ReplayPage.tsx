import { useParams } from "react-router-dom";
import { ReplayView } from "./ReplayView";

export function ReplayPage() {
  const { code = "" } = useParams();
  return (
    <main className="replay-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">赛后数据</p>
          <h1>房间 {code.toUpperCase()}</h1>
        </div>
      </header>
      <ReplayView />
    </main>
  );
}
