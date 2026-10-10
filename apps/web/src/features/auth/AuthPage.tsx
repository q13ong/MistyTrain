import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, LoaderCircle, Mail, UserRound } from "lucide-react";
import { api } from "../../api";
import { useAuthStore } from "../../store";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { user, loaded, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const redirect = search.get("redirect") || "/";

  if (loaded && user) return <Navigate to={redirect} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "register"
          ? await api.register({ email, nickname, password })
          : await api.login({ email, password });
      setUser(result.user);
      navigate(redirect, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="train-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">MistyTrain.com · 多人实时盲棋</p>
        <h1>雾中列车</h1>
        <p className="auth-copy">
          列车驶入浓雾。你不知道其他人的位置，只能判断下一步是否还会有人呼吸。
        </p>
      </section>

      <section className="auth-panel">
        <div className="segmented">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              <span>昵称</span>
              <div className="field">
                <UserRound size={18} />
                <input
                  autoComplete="nickname"
                  maxLength={16}
                  minLength={2}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="全局唯一昵称"
                  required
                  value={nickname}
                />
              </div>
            </label>
          )}
          <label>
            <span>邮箱</span>
            <div className="field">
              <Mail size={18} />
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="field">
              <KeyRound size={18} />
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                required
                type="password"
                value={password}
              />
            </div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary wide" disabled={busy} type="submit">
            {busy && <LoaderCircle className="spin" size={18} />}
            {mode === "login" ? "进入车站" : "创建账号"}
          </button>
        </form>
      </section>
    </main>
  );
}
