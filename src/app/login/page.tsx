"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/internal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError("Invalid username or password.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.logoSection}>
          <img src="/logo.svg" alt="Logo" style={styles.logo} />
          <div style={styles.brandText}>FORM SUBMISSIONS</div>
        </div>

        <div style={styles.card}>
          <p style={styles.subtitle}>
            To access this page, you have to log in to Form Submissions.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                autoComplete="current-password"
              />
            </div>

            {error && <p style={styles.error}>{error}</p>}

            <button type="submit" style={styles.button} disabled={loading}>
              {loading ? "Logging in..." : "Log In"}
            </button>

            <div style={styles.rememberRow}>
              <input
                type="checkbox"
                id="remember"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={styles.checkbox}
              />
              <label htmlFor="remember" style={styles.rememberLabel}>
                Remember me
              </label>
            </div>

            <div style={styles.divider} />

            <div style={styles.forgotLink}>Forgot Your Password?</div>
          </form>
        </div>
      </div>

      <div style={styles.footer}>
        &copy; {new Date().getFullYear()} Life at Lakewood. All rights reserved.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f4f6f9",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    maxWidth: 480,
    padding: "0 24px",
  },
  logoSection: {
    textAlign: "center" as const,
    marginBottom: 32,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 12,
  },
  brandText: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 3,
    color: "#0070d2",
  },
  card: {
    width: "100%",
    background: "#fff",
    border: "1px solid #d8dde6",
    borderRadius: 4,
    padding: "28px 32px 24px",
  },
  subtitle: {
    fontSize: 14,
    color: "#0070d2",
    marginBottom: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#3e3e3c",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #d8dde6",
    borderRadius: 4,
    outline: "none",
    color: "#16325c",
    background: "#fff",
    boxSizing: "border-box" as const,
  },
  error: {
    fontSize: 13,
    color: "#c23934",
    marginBottom: 12,
  },
  button: {
    width: "100%",
    padding: "12px",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: "#0070d2",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    marginBottom: 16,
  },
  rememberRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  checkbox: {
    width: 16,
    height: 16,
    cursor: "pointer",
  },
  rememberLabel: {
    fontSize: 13,
    color: "#3e3e3c",
    cursor: "pointer",
  },
  divider: {
    borderTop: "1px solid #d8dde6",
    marginBottom: 16,
  },
  forgotLink: {
    fontSize: 13,
    color: "#0070d2",
    cursor: "pointer",
  },
  footer: {
    position: "fixed" as const,
    bottom: 24,
    fontSize: 12,
    color: "#706e6b",
  },
};
