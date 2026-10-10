import { useEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { AuthPage } from "./features/auth/AuthPage";
import { HomePage } from "./features/lobby/HomePage";
import { JoinPage } from "./features/lobby/JoinPage";
import { RoomPage } from "./features/game/RoomPage";
import { ReplayPage } from "./features/replay/ReplayPage";
import { useAuthStore } from "./store";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loaded } = useAuthStore();
  const location = useLocation();
  if (!loaded) {
    return (
      <div className="full-loader">
        <LoaderCircle className="spin" />
      </div>
    );
  }
  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return children;
}

export function App() {
  const { load } = useAuthStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <HomePage />
          </Protected>
        }
      />
      <Route
        path="/join/:code"
        element={
          <Protected>
            <JoinPage />
          </Protected>
        }
      />
      <Route
        path="/room/:roomId"
        element={
          <Protected>
            <RoomPage />
          </Protected>
        }
      />
      <Route
        path="/replay/:code"
        element={
          <Protected>
            <ReplayPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
