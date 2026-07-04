/**
 * Northgate HRMS — frontend
 * -------------------------------------------------------------------------
 * Single-file React application wired to the FastAPI HRMS backend.
 *
 * Setup notes:
 *  - The API base URL is read from VITE_API_URL (falls back to
 *    http://localhost:8000). Create a `.env` with:
 *        VITE_API_URL=http://localhost:8000
 *  - Auth is cookie-based (httpOnly JWT). Every request is sent with
 *    `credentials: "include"`, and the backend's FRONTEND_ORIGIN setting
 *    must match this app's origin exactly for the cookie to round-trip.
 * -------------------------------------------------------------------------
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Filter,
  Fingerprint,
  Home,
  IndianRupee,
  Info,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCircle2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";

/* ============================================================================
 * API CLIENT
 * ==========================================================================*/

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:8000";

async function request(path, { method = "GET", body, params } = {}) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") qs.append(key, value);
    });
    const qsString = qs.toString();
    if (qsString) url += `?${qsString}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const err = new Error(
      "Can't reach the HRMS server. Check that the API is running and reachable."
    );
    err.status = 0;
    throw err;
  }

  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    if (data && typeof data === "object" && data.detail) {
      if (Array.isArray(data.detail)) {
        message = data.detail
          .map((d) => (d && d.msg ? d.msg : JSON.stringify(d)))
          .join(" ");
      } else if (typeof data.detail === "string") {
        message = data.detail;
      }
    } else if (typeof data === "string" && data) {
      message = data;
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

const api = {
  auth: {
    login: (email, password) => request("/api/auth/login", { method: "POST", body: { email, password } }),
    register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    me: () => request("/api/auth/me"),
  },
  users: {
    me: () => request("/api/users/me"),
    updateMe: (payload) => request("/api/users/me", { method: "PATCH", body: payload }),
    list: (params) => request("/api/users", { params }),
    create: (payload) => request("/api/users", { method: "POST", body: payload }),
    get: (id) => request(`/api/users/${id}`),
    update: (id, payload) => request(`/api/users/${id}`, { method: "PATCH", body: payload }),
    deactivate: (id) => request(`/api/users/${id}`, { method: "DELETE" }),
  },
  attendance: {
    checkIn: (payload) => request("/api/attendance/check-in", { method: "POST", body: payload }),
    checkOut: (payload) => request("/api/attendance/check-out", { method: "POST", body: payload }),
    me: (params) => request("/api/attendance/me", { params }),
    today: () => request("/api/attendance/today"),
    correct: (id, payload) => request(`/api/attendance/${id}`, { method: "PATCH", body: payload }),
  },
  leaves: {
    create: (payload) => request("/api/leaves", { method: "POST", body: payload }),
    list: (params) => request("/api/leaves", { params }),
    get: (id) => request(`/api/leaves/${id}`),
    review: (id, payload) => request(`/api/leaves/${id}`, { method: "PATCH", body: payload }),
    cancel: (id) => request(`/api/leaves/${id}/cancel`, { method: "PATCH" }),
  },
  payroll: {
    list: (params) => request("/api/payroll", { params }),
    get: (id) => request(`/api/payroll/${id}`),
    create: (payload) => request("/api/payroll", { method: "POST", body: payload }),
    update: (id, payload) => request(`/api/payroll/${id}`, { method: "PATCH", body: payload }),
    remove: (id) => request(`/api/payroll/${id}`, { method: "DELETE" }),
  },
};

/* ============================================================================
 * CONSTANTS & LOOKUPS
 * ==========================================================================*/

const ROLE_LABELS = {
  admin: "Administrator",
  hr: "HR Manager",
  manager: "Manager",
  employee: "Employee",
};

const ATTENDANCE_META = {
  present: { label: "Present", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  work_from_home: { label: "Remote", text: "text-sky-700", bg: "bg-sky-50", dot: "bg-sky-500", ring: "ring-sky-200" },
  half_day: { label: "Half day", text: "text-accent-700", bg: "bg-accent-50", dot: "bg-accent-500", ring: "ring-accent-200" },
  on_leave: { label: "On leave", text: "text-violet-700", bg: "bg-violet-50", dot: "bg-violet-500", ring: "ring-violet-200" },
  absent: { label: "Absent", text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500", ring: "ring-rose-200" },
};

const LEAVE_STATUS_META = {
  pending: { label: "Pending", text: "text-accent-700", bg: "bg-accent-50", dot: "bg-accent-500" },
  approved: { label: "Approved", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500" },
  cancelled: { label: "Withdrawn", text: "text-ink-400", bg: "bg-ink-50", dot: "bg-ink-300" },
};

const PAYROLL_STATUS_META = {
  pending: { label: "Pending", text: "text-accent-700", bg: "bg-accent-50", dot: "bg-accent-500" },
  processed: { label: "Processed", text: "text-sky-700", bg: "bg-sky-50", dot: "bg-sky-500" },
  paid: { label: "Paid", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  failed: { label: "Failed", text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500" },
};

const LEAVE_TYPE_LABELS = {
  sick: "Sick leave",
  casual: "Casual leave",
  earned: "Earned leave",
  unpaid: "Unpaid leave",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ============================================================================
 * UTILITIES
 * ==========================================================================*/

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

function toIsoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

function formatDate(value, opts = {}) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", ...opts });
}

function formatDateTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function formatHours(hoursDecimal) {
  if (hoursDecimal === null || hoursDecimal === undefined || Number.isNaN(hoursDecimal)) return "—";
  const h = Math.floor(hoursDecimal);
  const m = Math.round((hoursDecimal - h) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function avatarPalette(seed) {
  const palettes = [
    "bg-brand-500", "bg-accent-500", "bg-sky-500", "bg-violet-500", "bg-rose-500", "bg-emerald-500",
  ];
  let hash = 0;
  for (let i = 0; i < (seed || "").length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return palettes[Math.abs(hash) % palettes.length];
}

function daysBetweenInclusive(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
}

function relativeTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function buildMonthGrid(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/* ============================================================================
 * TOAST SYSTEM
 * ==========================================================================*/

const ToastContext = createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, variant = "info") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 5000);
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
      info: (m) => push(m, "info"),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[calc(100%-2.5rem)] max-w-sm flex-col gap-2.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-fadeUp flex items-start gap-3 rounded-xl border bg-white p-4 shadow-pop",
              t.variant === "success" && "border-l-4 border-l-emerald-500 border-y-slate-100 border-r-slate-100",
              t.variant === "error" && "border-l-4 border-l-rose-500 border-y-slate-100 border-r-slate-100",
              t.variant === "info" && "border-l-4 border-l-brand-500 border-y-slate-100 border-r-slate-100"
            )}
          >
            <div className="mt-0.5 shrink-0">
              {t.variant === "success" && <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" size={18} />}
              {t.variant === "error" && <AlertCircle className="text-rose-500" size={18} />}
              {t.variant === "info" && <Info className="text-brand-500" size={18} />}
            </div>
            <p className="flex-1 text-[13px] leading-snug text-ink-600">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-0.5 text-ink-300 transition hover:bg-slate-100 hover:text-ink-500"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast() {
  return useContext(ToastContext);
}

/* ============================================================================
 * AUTH CONTEXT / PROVIDER
 * ==========================================================================*/

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | authed | guest

  const bootstrap = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
      setStatus("authed");
    } catch {
      setUser(null);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email, password) => {
    const me = await api.auth.login(email, password);
    setUser(me);
    setStatus("authed");
    return me;
  }, []);

  const register = useCallback(async (payload) => {
    const me = await api.auth.register(payload);
    setUser(me);
    setStatus("authed");
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* clear client state regardless */
    }
    setUser(null);
    setStatus("guest");
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.users.me();
    setUser(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      login,
      register,
      logout,
      refreshUser,
      isPrivileged: !!user && (user.role === "admin" || user.role === "hr"),
    }),
    [user, status, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

/* ============================================================================
 * UI PRIMITIVES
 * ==========================================================================*/

function Avatar({ name, size = "md", src }) {
  const sizes = { sm: "h-8 w-8 text-[11px]", md: "h-10 w-10 text-xs", lg: "h-14 w-14 text-base" };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn("shrink-0 rounded-full object-cover ring-2 ring-white", sizes[size])}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white ring-2 ring-white",
        avatarPalette(name || "?"),
        sizes[size]
      )}
    >
      {initials(name)}
    </div>
  );
}

function Badge({ meta, children, className }) {
  if (meta) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
          meta.bg,
          meta.text,
          className
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
        {meta.label}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink-500", className)}>
      {children}
    </span>
  );
}

function Button({
  as: Comp = "button",
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  disabled,
  ...rest
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 select-none";
  const variants = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-900/10 focus-visible:ring-brand-400",
    accent: "bg-accent-500 text-ink-700 hover:bg-accent-600 shadow-sm shadow-accent-700/20 focus-visible:ring-accent-400",
    outline: "border border-slate-200 bg-white text-ink-600 hover:bg-slate-50 focus-visible:ring-brand-300",
    ghost: "text-ink-500 hover:bg-slate-100 focus-visible:ring-brand-300",
    danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 focus-visible:ring-rose-300",
    dangerFilled: "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-400",
  };
  const sizes = {
    sm: "rounded-lg px-3 py-1.5 text-[12.5px]",
    md: "rounded-xl px-4 py-2.5 text-[13.5px]",
    lg: "rounded-xl px-5 py-3 text-sm",
  };
  return (
    <Comp
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
      {children}
      {!loading && IconRight ? <IconRight size={16} /> : null}
    </Comp>
  );
}

function IconButton({ icon: Icon, className, label, ...rest }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition hover:bg-slate-100 hover:text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
        className
      )}
      {...rest}
    >
      <Icon size={16} />
    </button>
  );
}

function Card({ className, children, ...rest }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200/70 bg-white shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-500">{eyebrow}</p>
        )}
        <h2 className="font-display text-xl font-semibold text-ink-700">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-400">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

function Field({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ink-600">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-[12px] font-medium text-rose-600">
          <AlertCircle size={12} /> {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-ink-300">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[13.5px] text-ink-600 placeholder:text-ink-300 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-ink-300";

function Input({ icon: Icon, className, error, ...rest }) {
  return (
    <div className="relative">
      {Icon && <Icon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />}
      <input
        className={cn(inputBase, Icon && "pl-9", error && "border-rose-300 focus:border-rose-400 focus:ring-rose-100", className)}
        {...rest}
      />
    </div>
  );
}

function Textarea({ className, error, ...rest }) {
  return (
    <textarea
      className={cn(inputBase, "min-h-[90px] resize-none", error && "border-rose-300 focus:border-rose-400 focus:ring-rose-100", className)}
      {...rest}
    />
  );
}

function Select({ className, error, children, ...rest }) {
  return (
    <div className="relative">
      <select
        className={cn(inputBase, "appearance-none pr-9", error && "border-rose-300", className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-300" />
    </div>
  );
}

function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cn("flex items-center justify-between gap-3", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <span>
        {label && <span className="block text-[13px] font-semibold text-ink-600">{label}</span>}
        {description && <span className="block text-[12px] text-ink-300">{description}</span>}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-brand-500" : "bg-slate-200"
        )}
      >
        <span className={cn("inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </label>
  );
}

function Modal({ open, onClose, title, description, children, width = "max-w-lg" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-700/50 backdrop-blur-sm animate-fadeUp" onClick={onClose} />
      <div className={cn("relative z-10 w-full animate-fadeUp rounded-2xl bg-white p-6 shadow-pop", width)}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink-700">{title}</h3>
            {description && <p className="mt-1 text-[13px] text-ink-400">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", variant = "dangerFilled", loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} width="max-w-sm">
      <div className="flex justify-end gap-2.5 pt-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
        <Icon size={20} className="text-ink-300" />
      </div>
      <div>
        <p className="text-[14px] font-semibold text-ink-600">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-xs text-[12.5px] text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Spinner({ label = "Loading" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-300">
      <Loader2 size={22} className="animate-spin text-brand-400" />
      <p className="text-[12.5px] font-medium">{label}</p>
    </div>
  );
}

function InlineAlert({ variant = "info", children }) {
  const styles = {
    info: "bg-brand-50 text-brand-700 border-brand-100",
    error: "bg-rose-50 text-rose-700 border-rose-100",
    warning: "bg-accent-50 text-accent-700 border-accent-100",
    success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };
  const Icon = variant === "error" ? AlertCircle : variant === "success" ? CheckCircle2 : variant === "warning" ? AlertTriangle : Info;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-snug", styles[variant])}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Pagination({ skip, limit, count, onPrev, onNext }) {
  const page = Math.floor(skip / limit) + 1;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-1 pt-4 text-[12.5px] text-ink-400">
      <span>Page {page} &middot; showing {count} record{count === 1 ? "" : "s"}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" icon={ChevronLeft} onClick={onPrev} disabled={skip === 0}>Prev</Button>
        <Button variant="outline" size="sm" iconRight={ChevronRight} onClick={onNext} disabled={count < limit}>Next</Button>
      </div>
    </div>
  );
}

/* ============================================================================
 * AUTH SCREEN (Login / Register)
 * ==========================================================================*/

function BrandPanel() {
  const now = useLiveClock();
  const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-ink-700 p-10 text-white lg:flex">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/30 blur-3xl" />
      <div className="absolute -left-16 bottom-0 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />

      <div className="relative z-10 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500">
          <Fingerprint size={18} className="text-ink-700" />
        </div>
        <span className="font-display text-lg font-semibold tracking-tight">Northgate HRMS</span>
      </div>

      <div className="relative z-10">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-accent-400">{date}</p>
        <p className="font-mono text-6xl font-medium tabular-nums tracking-tight">{time}</p>
        <p className="mt-6 max-w-sm text-[14px] leading-relaxed text-white/70">
          Every clock-in, leave request, and payslip in one ledger — punctual,
          precise, and always accounted for.
        </p>
      </div>

      <div className="relative z-10 flex gap-6 border-t border-white/10 pt-5 text-[12.5px] text-white/60">
        <div className="flex items-center gap-2"><Clock size={14} className="text-accent-400" /> Live attendance</div>
        <div className="flex items-center gap-2"><CalendarDays size={14} className="text-accent-400" /> Leave workflow</div>
        <div className="flex items-center gap-2"><IndianRupee size={14} className="text-accent-400" /> Payroll ledger</div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState("login"); // login | register
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [regForm, setRegForm] = useState({
    full_name: "", employee_id: "", email: "", department: "", password: "", confirm: "",
  });

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(loginForm.email.trim(), loginForm.password);
      toast.success("Welcome back — you're signed in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    if (regForm.password !== regForm.confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await register({
        full_name: regForm.full_name.trim(),
        employee_id: regForm.employee_id.trim(),
        email: regForm.email.trim(),
        department: regForm.department.trim() || null,
        password: regForm.password,
        role: "employee",
      });
      toast.success("Account created. Welcome to Northgate HRMS!");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <BrandPanel />
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500">
              <Fingerprint size={18} className="text-ink-700" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-ink-700">Northgate HRMS</span>
          </div>

          <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className={cn("flex-1 rounded-lg py-2 text-[13px] font-semibold transition", mode === "login" ? "bg-white text-ink-700 shadow-sm" : "text-ink-400 hover:text-ink-600")}
            >
              Sign in
            </button>
            <button
              onClick={() => { setMode("register"); setError(""); }}
              className={cn("flex-1 rounded-lg py-2 text-[13px] font-semibold transition", mode === "register" ? "bg-white text-ink-700 shadow-sm" : "text-ink-400 hover:text-ink-600")}
            >
              Create account
            </button>
          </div>

          {mode === "login" ? (
            <>
              <h1 className="font-display text-2xl font-semibold text-ink-700">Welcome back</h1>
              <p className="mt-1 mb-6 text-[13.5px] text-ink-400">Sign in with your work email to punch in.</p>
              {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
              <form className="flex flex-col gap-4" onSubmit={handleLogin}>
                <Field label="Work email" required>
                  <Input icon={Mail} type="email" required placeholder="you@company.com" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                </Field>
                <Field label="Password" required>
                  <div className="relative">
                    <Input icon={KeyRound} type={showPassword ? "text" : "password"} required placeholder="••••••••" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} className="pr-10" />
                    <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-500">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
                <Button type="submit" size="lg" loading={submitting} iconRight={ArrowRight} className="mt-1 w-full">Sign in</Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold text-ink-700">Create your account</h1>
              <p className="mt-1 mb-6 text-[13.5px] text-ink-400">New employee accounts start with standard access.</p>
              {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
              <form className="flex flex-col gap-4" onSubmit={handleRegister}>
                <Field label="Full name" required>
                  <Input icon={UserCircle2} required placeholder="Jordan Alvarez" value={regForm.full_name} onChange={(e) => setRegForm({ ...regForm, full_name: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Employee ID" required>
                    <Input icon={Briefcase} required placeholder="EMP-1042" value={regForm.employee_id} onChange={(e) => setRegForm({ ...regForm, employee_id: e.target.value })} />
                  </Field>
                  <Field label="Department">
                    <Input icon={Building2} placeholder="Engineering" value={regForm.department} onChange={(e) => setRegForm({ ...regForm, department: e.target.value })} />
                  </Field>
                </div>
                <Field label="Work email" required>
                  <Input icon={Mail} type="email" required placeholder="you@company.com" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Password" required hint="8+ chars, letters & numbers">
                    <Input icon={KeyRound} type="password" required minLength={8} value={regForm.password} onChange={(e) => setRegForm({ ...regForm, password: e.target.value })} />
                  </Field>
                  <Field label="Confirm password" required>
                    <Input icon={KeyRound} type="password" required minLength={8} value={regForm.confirm} onChange={(e) => setRegForm({ ...regForm, confirm: e.target.value })} />
                  </Field>
                </div>
                <Button type="submit" size="lg" loading={submitting} iconRight={ArrowRight} className="mt-1 w-full">Create account</Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * APP SHELL — sidebar, topbar, role-based router
 * ==========================================================================*/

const EMPLOYEE_NAV = [
  { key: "dashboard", label: "Time clock", icon: Home },
  { key: "profile", label: "My profile", icon: UserCircle2 },
  { key: "leave", label: "Leave", icon: CalendarDays },
  { key: "payroll", label: "Payroll", icon: IndianRupee },
];

const ADMIN_NAV = [
  { key: "directory", label: "Directory", icon: Users },
  { key: "tracker", label: "Live tracker", icon: Fingerprint },
  { key: "approvals", label: "Leave approvals", icon: CalendarDays },
  { key: "payroll", label: "Payroll ledger", icon: Landmark },
];

function Sidebar({ nav, active, onSelect, roleLabel }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/70 bg-white md:flex">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500">
          <Fingerprint size={18} className="text-ink-700" />
        </div>
        <div>
          <p className="font-display text-[15px] font-semibold leading-tight text-ink-700">Northgate</p>
          <p className="text-[11px] font-medium text-ink-300">HRMS</p>
        </div>
      </div>

      <div className="mx-4 mb-2 rounded-lg bg-slate-50 px-3 py-1.5 text-center text-[10.5px] font-bold uppercase tracking-wider text-ink-300">
        {roleLabel}
      </div>

      <nav className="flex-1 space-y-1 px-4 py-2">
        {nav.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-all",
              active === item.key ? "bg-brand-500 text-white shadow-sm shadow-brand-900/15" : "text-ink-500 hover:bg-slate-100"
            )}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <div className="rounded-xl bg-ink-700 p-4 text-white">
          <Sparkles size={16} className="text-accent-400" />
          <p className="mt-2 text-[12px] leading-snug text-white/70">
            Punctuality is tracked automatically — arrive within the grace window to stay marked present.
          </p>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ nav, active, onSelect }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2.5 scrollbar-thin md:hidden">
      {nav.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition",
            active === item.key ? "bg-brand-500 text-white" : "bg-slate-100 text-ink-500"
          )}
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Topbar({ title, description }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const now = useLiveClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      toast.info("You've been signed out.");
    }
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur">
      <div>
        <h1 className="font-display text-lg font-semibold text-ink-700">{title}</h1>
        {description && <p className="text-[12.5px] text-ink-400">{description}</p>}
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3.5 py-1.5 font-mono text-[13px] font-medium text-ink-500 sm:flex">
          <Clock size={13} className="text-brand-400" />
          {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>

        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-slate-100">
            <Avatar name={user?.full_name} size="sm" src={user?.profile_picture} />
            <span className="hidden text-left sm:block">
              <span className="block text-[13px] font-semibold leading-tight text-ink-700">{user?.full_name}</span>
              <span className="block text-[11px] leading-tight text-ink-300">{ROLE_LABELS[user?.role] || user?.role}</span>
            </span>
            <ChevronDown size={14} className="hidden text-ink-300 sm:block" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-100 bg-white p-1.5 shadow-pop">
                <div className="px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-ink-700">{user?.full_name}</p>
                  <p className="truncate text-[11.5px] text-ink-300">{user?.email}</p>
                </div>
                <div className="my-1 h-px bg-slate-100" />
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const PAGE_META = {
  dashboard: { title: "Time clock", description: "Check in, check out, and track your day." },
  profile: { title: "My profile", description: "Manage your personal contact details." },
  leave: { title: "Leave", description: "Request time off and track approvals." },
  payroll: { title: "Payroll", description: "Your salary history and payslips." },
  directory: { title: "Employee directory", description: "Search, provision, and manage every account." },
  tracker: { title: "Live attendance tracker", description: "Real-time view of who's in today." },
  approvals: { title: "Leave approvals", description: "Review pending requests and leave history." },
};

function EmployeeApp() {
  const [active, setActive] = useState("dashboard");
  const meta = PAGE_META[active];
  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar nav={EMPLOYEE_NAV} active={active} onSelect={setActive} roleLabel="Employee workspace" />
      <div className="flex min-h-screen flex-1 flex-col">
        <MobileNav nav={EMPLOYEE_NAV} active={active} onSelect={setActive} />
        <Topbar title={meta.title} description={meta.description} />
        <main className="flex-1 p-5 sm:p-8">
          {active === "dashboard" && <EmployeeDashboard />}
          {active === "profile" && <EmployeeProfile />}
          {active === "leave" && <EmployeeLeave />}
          {active === "payroll" && <EmployeePayroll />}
        </main>
      </div>
    </div>
  );
}

function AdminApp() {
  const [active, setActive] = useState("directory");
  const meta = PAGE_META[active];
  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar nav={ADMIN_NAV} active={active} onSelect={setActive} roleLabel="Admin console" />
      <div className="flex min-h-screen flex-1 flex-col">
        <MobileNav nav={ADMIN_NAV} active={active} onSelect={setActive} />
        <Topbar title={meta.title} description={meta.description} />
        <main className="flex-1 p-5 sm:p-8">
          {active === "directory" && <AdminDirectory />}
          {active === "tracker" && <AdminTracker />}
          {active === "approvals" && <AdminLeaveApprovals />}
          {active === "payroll" && <AdminPayroll />}
        </main>
      </div>
    </div>
  );
}

/** Dynamic role-based router: splits the entire view tree by role. */
function RoleRouter() {
  const { isPrivileged } = useAuth();
  return isPrivileged ? <AdminApp /> : <EmployeeApp />;
}

/* ============================================================================
 * EMPLOYEE — Dashboard / Time clock
 * ==========================================================================*/

function useElapsed(startIso, endIso) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startIso || endIso) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [startIso, endIso]);

  if (!startIso) return 0;
  const end = endIso ? new Date(endIso) : new Date();
  return (end.getTime() - new Date(startIso).getTime()) / 3600000;
}

function StatCard({ icon: Icon, label, value, tone = "brand" }) {
  const tones = {
    brand: "bg-brand-50 text-brand-600",
    accent: "bg-accent-50 text-accent-700",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon size={19} />
      </div>
      <div>
        <p className="font-display text-xl font-semibold text-ink-700">{value}</p>
        <p className="text-[12px] font-medium text-ink-400">{label}</p>
      </div>
    </Card>
  );
}

function TimeClockCard({ record, onCheckIn, onCheckOut, actionLoading, actionError }) {
  const now = useLiveClock();
  const [wfh, setWfh] = useState(false);
  const [notes, setNotes] = useState("");
  const elapsed = useElapsed(record?.check_in, record?.check_out);

  const hasCheckedIn = !!record?.check_in;
  const hasCheckedOut = !!record?.check_out;
  const meta = record ? ATTENDANCE_META[record.status] : null;

  return (
    <Card className="relative overflow-hidden p-7">
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-50" />
      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-500">
            {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <p className="mt-1 font-mono text-5xl font-medium tabular-nums text-ink-700">
            {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>

        <button
          type="button"
          onClick={hasCheckedIn ? (hasCheckedOut ? undefined : onCheckOut) : () => onCheckIn(wfh, notes)}
          disabled={actionLoading || hasCheckedOut}
          className={cn(
            "flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-full text-white transition-transform duration-150 focus-visible:outline-none disabled:cursor-not-allowed",
            hasCheckedOut ? "bg-ink-300" : hasCheckedIn ? "bg-brand-500 hover:scale-105 active:scale-95" : "animate-pulseRing bg-accent-500 text-ink-700 hover:scale-105 active:scale-95"
          )}
        >
          {actionLoading ? (
            <Loader2 size={26} className="animate-spin" />
          ) : hasCheckedOut ? (
            <>
              <CheckCircle2 size={26} />
              <span className="text-[12px] font-bold uppercase tracking-wide">Day done</span>
            </>
          ) : hasCheckedIn ? (
            <>
              <Fingerprint size={26} />
              <span className="text-[12px] font-bold uppercase tracking-wide">Check out</span>
            </>
          ) : (
            <>
              <Fingerprint size={26} />
              <span className="text-[12px] font-bold uppercase tracking-wide">Check in</span>
            </>
          )}
        </button>

        {!hasCheckedIn && (
          <div className="flex w-full max-w-xs flex-col gap-3">
            <Toggle checked={wfh} onChange={setWfh} label="Working remotely today" description="Marks today as a remote day" />
            <Input placeholder="Add a note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={280} />
          </div>
        )}

        {actionError && <InlineAlert variant="error">{actionError}</InlineAlert>}

        {record && (
          <div className="grid w-full grid-cols-3 divide-x divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Checked in</p>
              <p className="font-mono text-[14px] font-semibold text-ink-600">{formatTime(record.check_in)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Checked out</p>
              <p className="font-mono text-[14px] font-semibold text-ink-600">{formatTime(record.check_out)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Hours logged</p>
              <p className="font-mono text-[14px] font-semibold text-ink-600">{hasCheckedIn ? formatHours(elapsed) : "—"}</p>
            </div>
          </div>
        )}

        {meta && (
          <Badge meta={meta} />
        )}
      </div>
    </Card>
  );
}

function EmployeeDashboard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const monthStart = useMemo(() => {
    const d = new Date();
    return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.attendance.me({ start_date: monthStart, end_date: todayIso(), limit: 62 });
      setHistory(rows);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [monthStart, toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const todayRecord = history.find((r) => r.date === todayIso()) || null;

  const counts = useMemo(() => {
    const c = { present: 0, half_day: 0, absent: 0, on_leave: 0, work_from_home: 0 };
    history.forEach((r) => { if (c[r.status] !== undefined) c[r.status] += 1; });
    return c;
  }, [history]);

  async function handleCheckIn(wfh, notes) {
    setActionError("");
    setActionLoading(true);
    try {
      await api.attendance.checkIn({ work_from_home: wfh, notes: notes || null });
      toast.success(wfh ? "Checked in remotely. Have a productive day!" : "Checked in. Have a productive day!");
      await loadHistory();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCheckOut() {
    setActionError("");
    setActionLoading(true);
    try {
      await api.attendance.checkOut({});
      toast.success("Checked out. See you tomorrow!");
      await loadHistory();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <TimeClockCard record={todayRecord} onCheckIn={handleCheckIn} onCheckOut={handleCheckOut} actionLoading={actionLoading} actionError={actionError} />
      </div>

      <div className="flex flex-col gap-6 lg:col-span-2">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard icon={CheckCircle2} label="Present days" value={counts.present} tone="emerald" />
          <StatCard icon={Clock} label="Half days" value={counts.half_day} tone="accent" />
          <StatCard icon={Ban} label="Absences" value={counts.absent} tone="rose" />
          <StatCard icon={CalendarDays} label="On leave" value={counts.on_leave} tone="violet" />
        </div>

        <Card className="p-6">
          <SectionHeader eyebrow="This month" title="Recent activity" description="Your latest attendance records." action={<IconButton icon={RefreshCw} label="Refresh" onClick={loadHistory} />} />
          {loading ? (
            <Spinner label="Loading attendance…" />
          ) : history.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No attendance yet this month" description="Check in above to start building your record." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Check in</th>
                    <th className="pb-3 pr-4">Check out</th>
                    <th className="pb-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.slice(0, 8).map((r) => (
                    <tr key={r._id}>
                      <td className="py-3 pr-4 font-medium text-ink-600">{formatDate(r.date)}</td>
                      <td className="py-3 pr-4"><Badge meta={ATTENDANCE_META[r.status]} /></td>
                      <td className="py-3 pr-4 font-mono text-ink-500">{formatTime(r.check_in)}</td>
                      <td className="py-3 pr-4 font-mono text-ink-500">{formatTime(r.check_out)}</td>
                      <td className="py-3 text-ink-400">{r.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================================
 * EMPLOYEE — Profile
 * ==========================================================================*/

function EmployeeProfile() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ phone: user?.phone || "", address: user?.address || "", profile_picture: user?.profile_picture || "" });

  useEffect(() => {
    setForm({ phone: user?.phone || "", address: user?.address || "", profile_picture: user?.profile_picture || "" });
  }, [user]);

  function startEdit() {
    setError("");
    setEditing(true);
  }
  function cancelEdit() {
    setForm({ phone: user?.phone || "", address: user?.address || "", profile_picture: user?.profile_picture || "" });
    setError("");
    setEditing(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {};
      if (form.phone !== (user.phone || "")) payload.phone = form.phone || null;
      if (form.address !== (user.address || "")) payload.address = form.address || null;
      if (form.profile_picture !== (user.profile_picture || "")) payload.profile_picture = form.profile_picture || null;

      if (Object.keys(payload).length === 0) {
        setEditing(false);
        setSaving(false);
        return;
      }
      await api.users.updateMe(payload);
      await refreshUser();
      toast.success("Profile updated.");
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <Spinner label="Loading profile…" />;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="flex flex-col items-center gap-4 p-7 text-center lg:col-span-1">
        <Avatar name={user.full_name} size="lg" src={user.profile_picture} />
        <div>
          <p className="font-display text-lg font-semibold text-ink-700">{user.full_name}</p>
          <p className="text-[13px] text-ink-400">{user.email}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Badge>{ROLE_LABELS[user.role] || user.role}</Badge>
          {user.department && <Badge>{user.department}</Badge>}
          <Badge meta={user.is_active ? { label: "Active", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" } : { label: "Deactivated", text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500" }} />
        </div>
        <div className="grid w-full grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-left">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Employee ID</p>
            <p className="font-mono text-[13px] font-medium text-ink-600">{user.employee_id}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Member since</p>
            <p className="text-[13px] font-medium text-ink-600">{formatDate(user.created_at)}</p>
          </div>
          <div className="col-span-2 flex items-center gap-1.5">
            {user.email_verified ? <ShieldCheck size={13} className="text-emerald-500" /> : <Shield size={13} className="text-ink-300" />}
            <p className="text-[12px] text-ink-400">{user.email_verified ? "Email verified" : "Email not verified"}</p>
          </div>
        </div>
      </Card>

      <Card className="p-7 lg:col-span-2">
        <SectionHeader
          eyebrow="Contact details"
          title="Personal information"
          description="Only your contact details are self-editable. Ask HR to update your role, department, or ID."
          action={!editing ? <Button variant="outline" icon={Pencil} onClick={startEdit}>Edit profile</Button> : null}
        />

        {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}

        <form onSubmit={handleSave} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input icon={UserCircle2} value={user.full_name} disabled />
            </Field>
            <Field label="Work email">
              <Input icon={Mail} value={user.email} disabled />
            </Field>
            <Field label="Phone number" hint={editing ? "Digits, spaces, + and - only" : undefined}>
              <Input icon={Phone} placeholder="+91 98765 43210" value={form.phone} disabled={!editing} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <Input icon={Building2} value={user.department || "Not assigned"} disabled />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea placeholder="Street, city, state, PIN" value={form.address} disabled={!editing} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Profile picture URL" hint="Paste a link to an image">
              <Input icon={UserCircle2} placeholder="https://…" value={form.profile_picture} disabled={!editing} onChange={(e) => setForm({ ...form, profile_picture: e.target.value })} />
            </Field>
          </div>

          {editing && (
            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
              <Button type="button" variant="outline" onClick={cancelEdit}>Cancel</Button>
              <Button type="submit" icon={Save} loading={saving}>Save changes</Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

/* ============================================================================
 * SHARED — Leave calendar
 * ==========================================================================*/

function leaveStatusForDay(leaves, dateObj) {
  if (!dateObj) return null;
  const iso = toIsoDate(dateObj);
  const priority = ["approved", "pending", "rejected", "cancelled"];
  let best = null;
  for (const lv of leaves) {
    if (iso >= lv.start_date && iso <= lv.end_date) {
      if (!best || priority.indexOf(lv.status) < priority.indexOf(best.status)) best = lv;
    }
  }
  return best;
}

function LeaveCalendar({ leaves }) {
  const [cursor, setCursor] = useState(() => new Date());
  const year = cursor.getFullYear();
  const monthIndex = cursor.getMonth();
  const weeks = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);
  const todayStr = todayIso();

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-display text-[15px] font-semibold text-ink-700">{MONTH_LABELS[monthIndex]} {year}</p>
        <div className="flex gap-1.5">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setCursor(new Date(year, monthIndex - 1, 1))} />
          <IconButton icon={ChevronRight} label="Next month" onClick={() => setCursor(new Date(year, monthIndex + 1, 1))} />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold uppercase tracking-wide text-ink-300">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1.5">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day, i) => {
          const leave = leaveStatusForDay(leaves, day);
          const meta = leave ? LEAVE_STATUS_META[leave.status] : null;
          const isToday = day && toIsoDate(day) === todayStr;
          return (
            <div
              key={i}
              title={leave ? `${LEAVE_TYPE_LABELS[leave.leave_type]} — ${LEAVE_STATUS_META[leave.status].label}` : undefined}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg text-[12.5px] font-medium",
                !day && "invisible",
                day && !meta && "text-ink-500",
                meta && cn(meta.bg, meta.text, "font-semibold"),
                isToday && "ring-2 ring-brand-400"
              )}
            >
              {day ? day.getDate() : ""}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
        {Object.entries(LEAVE_STATUS_META).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
            <span className={cn("h-2 w-2 rounded-full", meta.dot)} /> {meta.label}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ============================================================================
 * EMPLOYEE — Leave
 * ==========================================================================*/

function LeaveRequestCard({ leave, onCancel, cancelling }) {
  const meta = LEAVE_STATUS_META[leave.status];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-ink-400">
          <CalendarDays size={16} />
        </div>
        <div>
          <p className="text-[13.5px] font-semibold text-ink-700">{LEAVE_TYPE_LABELS[leave.leave_type]}</p>
          <p className="text-[12.5px] text-ink-400">{formatDate(leave.start_date)} — {formatDate(leave.end_date)} &middot; {leave.total_days} day{leave.total_days === 1 ? "" : "s"}</p>
          <p className="mt-1 max-w-md text-[12.5px] text-ink-400">"{leave.reason}"</p>
          {leave.review_comment && (
            <p className="mt-1 text-[12px] italic text-ink-300">HR note: {leave.review_comment}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 self-start sm:self-center">
        <Badge meta={meta} />
        {leave.status === "pending" && (
          <Button size="sm" variant="danger" loading={cancelling} onClick={() => onCancel(leave._id)}>Withdraw</Button>
        )}
      </div>
    </div>
  );
}

function EmployeeLeave() {
  const toast = useToast();
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ leave_type: "casual", start_date: todayIso(), end_date: todayIso(), reason: "" });

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.leaves.list({ limit: 100 });
      setLeaves(rows);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadLeaves(); }, [loadLeaves]);

  const totalDays = daysBetweenInclusive(form.start_date, form.end_date);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.leaves.create(form);
      toast.success("Leave request submitted for review.");
      setForm({ leave_type: "casual", start_date: todayIso(), end_date: todayIso(), reason: "" });
      await loadLeaves();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id) {
    setCancellingId(id);
    try {
      await api.leaves.cancel(id);
      toast.success("Leave request withdrawn.");
      await loadLeaves();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  const sorted = [...leaves].sort((a, b) => new Date(b.applied_on) - new Date(a.applied_on));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-1">
        <Card className="p-6">
          <SectionHeader eyebrow="New request" title="Request time off" />
          {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Leave type" required>
              <Select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
                {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" required>
                <Input icon={CalendarIcon} type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </Field>
              <Field label="End date" required>
                <Input icon={CalendarIcon} type="date" required min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason" required>
              <Textarea required maxLength={500} placeholder="Briefly describe why you're requesting leave…" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-[12.5px] font-medium text-ink-500">
              <span>Duration</span>
              <span className="font-mono font-semibold text-ink-700">{totalDays} day{totalDays === 1 ? "" : "s"}</span>
            </div>
            <Button type="submit" loading={submitting} icon={Plus} className="w-full">Send request</Button>
          </form>
        </Card>

        <LeaveCalendar leaves={leaves} />
      </div>

      <Card className="p-6 lg:col-span-2">
        <SectionHeader eyebrow="History" title="Your leave requests" description="Track status and withdraw pending requests." action={<IconButton icon={RefreshCw} label="Refresh" onClick={loadLeaves} />} />
        {loading ? (
          <Spinner label="Loading leave requests…" />
        ) : sorted.length === 0 ? (
          <EmptyState icon={CalendarX2} title="No leave requests yet" description="Submit your first request using the form on the left." />
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((lv) => (
              <LeaveRequestCard key={lv._id} leave={lv} onCancel={handleCancel} cancelling={cancellingId === lv._id} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================================
 * EMPLOYEE — Payroll (read-only)
 * ==========================================================================*/

function PayslipModal({ record, onClose }) {
  if (!record) return null;
  return (
    <Modal open={!!record} onClose={onClose} title={`Payslip — ${MONTH_LABELS[record.month - 1]} ${record.year}`} description={record.employee_id} width="max-w-md">
      <div className="rounded-xl border border-dashed border-slate-200 p-5">
        <div className="flex items-center justify-between border-b border-dashed border-slate-200 pb-4">
          <div className="flex items-center gap-2 text-ink-400"><Landmark size={16} /> <span className="text-[12.5px] font-semibold uppercase tracking-wide">Payslip</span></div>
          <Badge meta={PAYROLL_STATUS_META[record.status]} />
        </div>
        <div className="flex flex-col gap-2.5 py-4 text-[13.5px]">
          <div className="flex justify-between"><span className="text-ink-400">Basic salary</span><span className="font-mono font-medium text-ink-700">{formatMoney(record.basic_salary)}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Allowances</span><span className="font-mono font-medium text-emerald-600">+ {formatMoney(record.allowances)}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Deductions</span><span className="font-mono font-medium text-rose-600">- {formatMoney(record.deductions)}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Tax</span><span className="font-mono font-medium text-rose-600">- {formatMoney(record.tax)}</span></div>
        </div>
        <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-4">
          <span className="text-[13px] font-semibold text-ink-700">Net pay</span>
          <span className="font-mono text-lg font-semibold text-ink-700">{formatMoney(record.net_salary)}</span>
        </div>
        <p className="mt-4 text-[11.5px] text-ink-300">
          Generated {formatDate(record.generated_on)}{record.paid_on ? ` · Paid ${formatDate(record.paid_on)}` : ""}
        </p>
      </div>
    </Modal>
  );
}

function EmployeePayroll() {
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRecords(await api.payroll.list({ limit: 100 }));
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const currentYear = new Date().getFullYear();
  const latest = records[0];
  const ytdNet = records.filter((r) => r.year === currentYear).reduce((sum, r) => sum + r.net_salary, 0);
  const ytdDeductions = records.filter((r) => r.year === currentYear).reduce((sum, r) => sum + r.deductions + r.tax, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={IndianRupee} label={latest ? `Latest net pay (${MONTH_LABELS[latest.month - 1]})` : "Latest net pay"} value={latest ? formatMoney(latest.net_salary) : "—"} tone="emerald" />
        <StatCard icon={Wallet} label={`${currentYear} earnings to date`} value={formatMoney(ytdNet)} tone="brand" />
        <StatCard icon={Ban} label={`${currentYear} deductions & tax`} value={formatMoney(ytdDeductions)} tone="rose" />
      </div>

      <Card className="p-6">
        <SectionHeader eyebrow="Read-only" title="Payslip history" description="Generated by HR — reach out to payroll for corrections." />
        {loading ? (
          <Spinner label="Loading payroll history…" />
        ) : records.length === 0 ? (
          <EmptyState icon={IndianRupee} title="No payslips yet" description="Your payroll history will appear here once HR generates your first payslip." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                  <th className="pb-3 pr-4">Period</th>
                  <th className="pb-3 pr-4">Basic</th>
                  <th className="pb-3 pr-4">Allowances</th>
                  <th className="pb-3 pr-4">Deductions</th>
                  <th className="pb-3 pr-4">Net pay</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r._id}>
                    <td className="py-3 pr-4 font-medium text-ink-600">{MONTH_LABELS[r.month - 1]} {r.year}</td>
                    <td className="py-3 pr-4 font-mono text-ink-500">{formatMoney(r.basic_salary)}</td>
                    <td className="py-3 pr-4 font-mono text-emerald-600">+{formatMoney(r.allowances)}</td>
                    <td className="py-3 pr-4 font-mono text-rose-600">-{formatMoney(r.deductions + r.tax)}</td>
                    <td className="py-3 pr-4 font-mono font-semibold text-ink-700">{formatMoney(r.net_salary)}</td>
                    <td className="py-3 pr-4"><Badge meta={PAYROLL_STATUS_META[r.status]} /></td>
                    <td className="py-3"><Button size="sm" variant="outline" onClick={() => setSelected(r)}>View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PayslipModal record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ============================================================================
 * ADMIN — Directory (master picker + detail editor)
 * ==========================================================================*/

const DEPARTMENT_SUGGESTIONS = ["Engineering", "Sales", "Marketing", "Finance", "Human Resources", "Operations", "Support", "Design"];

function CreateEmployeeModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blank = { full_name: "", employee_id: "", email: "", department: "", role: "employee", phone: "", address: "", password: "" };
  const [form, setForm] = useState(blank);

  useEffect(() => { if (open) { setForm(blank); setError(""); } }, [open]); // eslint-disable-line

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api.users.create({
        ...form,
        department: form.department || null,
        phone: form.phone || null,
        address: form.address || null,
      });
      toast.success(`${created.full_name}'s account has been created.`);
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Provision a new employee" description="Creates a pre-verified account with immediate access." width="max-w-lg">
      {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" required>
            <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Employee ID" required>
            <Input required placeholder="EMP-1042" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
          </Field>
        </div>
        <Field label="Work email" required>
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <Input list="dept-suggestions" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <datalist id="dept-suggestions">
              {DEPARTMENT_SUGGESTIONS.map((d) => <option key={d} value={d} />)}
            </datalist>
          </Field>
          <Field label="Role" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Temporary password" required hint="8+ chars, letters & numbers">
            <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={UserPlus} loading={saving}>Create employee</Button>
        </div>
      </form>
    </Modal>
  );
}

function EmployeeDetailPanel({ record, onUpdated, onDeactivated, isSelf }) {
  const toast = useToast();
  const [form, setForm] = useState(record);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setForm(record); setError(""); }, [record]);

  const dirty = record && form && JSON.stringify({ ...record }) !== JSON.stringify({ ...form });

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {};
      ["full_name", "email", "employee_id", "department", "role", "phone", "address", "is_active", "email_verified"].forEach((key) => {
        if (form[key] !== record[key]) payload[key] = form[key] === "" ? null : form[key];
      });
      if (Object.keys(payload).length === 0) { setSaving(false); return; }
      const updated = await api.users.update(record._id, payload);
      onUpdated(updated);
      toast.success("Employee record updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await api.users.deactivate(record._id);
      toast.success(`${record.full_name}'s account was deactivated.`);
      onDeactivated(record._id);
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeactivating(false);
    }
  }

  if (!record || !form) {
    return (
      <Card className="flex flex-1 items-center p-6">
        <EmptyState icon={Users} title="Select an employee" description="Choose someone from the directory on the left to view and edit their record." />
      </Card>
    );
  }

  return (
    <Card className="flex-1 p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <Avatar name={form.full_name} size="lg" src={form.profile_picture} />
          <div>
            <p className="font-display text-lg font-semibold text-ink-700">{form.full_name}</p>
            <p className="text-[12.5px] text-ink-400">{form.employee_id} &middot; {form.email}</p>
          </div>
        </div>
        <Badge meta={form.is_active ? { label: "Active", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" } : { label: "Deactivated", text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500" }} />
      </div>

      {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
      {isSelf && <div className="mb-4"><InlineAlert variant="warning">This is your own account — role changes and deactivation are disabled to prevent lockouts.</InlineAlert></div>}

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Work email" required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Employee ID" required>
            <Input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
          </Field>
          <Field label="Department">
            <Input list="dept-suggestions-edit" value={form.department || ""} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <datalist id="dept-suggestions-edit">{DEPARTMENT_SUGGESTIONS.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Role" required>
            <Select disabled={isSelf} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:justify-between">
          <Toggle checked={form.email_verified} onChange={(v) => setForm({ ...form, email_verified: v })} label="Email verified" />
          <Toggle checked={form.is_active} disabled={isSelf} onChange={(v) => setForm({ ...form, is_active: v })} label="Account active" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <Button type="button" variant="danger" icon={Trash2} disabled={isSelf} onClick={() => setConfirmOpen(true)}>Deactivate account</Button>
          <Button type="submit" icon={Save} loading={saving} disabled={!dirty}>Save changes</Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDeactivate}
        loading={deactivating}
        title="Deactivate this account?"
        description={`${record.full_name} will no longer be able to sign in. Their attendance, leave, and payroll history stays intact for audit purposes.`}
        confirmLabel="Deactivate"
      />
    </Card>
  );
}

function AdminDirectory() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [skip, setSkip] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const limit = 12;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.users.list({
        search: search || undefined,
        role: roleFilter || undefined,
        is_active: statusFilter === "" ? undefined : statusFilter === "active",
        skip,
        limit,
      });
      setRows(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, skip, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSkip(0); }, [search, roleFilter, statusFilter]);

  const selected = rows.find((r) => r._id === selectedId) || null;

  function handleUpdated(updated) {
    setRows((prev) => prev.map((r) => (r._id === updated._id ? updated : r)));
  }
  function handleDeactivated(id) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, is_active: false } : r)));
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <Card className="flex w-full flex-col p-5 lg:w-[380px] lg:shrink-0">
        <SectionHeader eyebrow={`${rows.length} shown`} title="Directory" action={<Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>New</Button>} />

        <div className="flex flex-col gap-2.5">
          <Input icon={Search} placeholder="Search name, email, ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid grid-cols-2 gap-2.5">
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex-1 space-y-1.5 overflow-y-auto scrollbar-thin" style={{ maxHeight: 520 }}>
          {loading ? (
            <Spinner label="Loading directory…" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title="No matches" description="Try a different search term or filter." />
          ) : (
            rows.map((r) => (
              <button
                key={r._id}
                onClick={() => setSelectedId(r._id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                  selectedId === r._id ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50"
                )}
              >
                <Avatar name={r.full_name} size="sm" src={r.profile_picture} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-700">{r.full_name}</p>
                  <p className="truncate text-[11.5px] text-ink-400">{r.employee_id} &middot; {ROLE_LABELS[r.role]}</p>
                </div>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", r.is_active ? "bg-emerald-500" : "bg-rose-400")} />
              </button>
            ))
          )}
        </div>

        <Pagination skip={skip} limit={limit} count={rows.length} onPrev={() => setSkip((s) => Math.max(0, s - limit))} onNext={() => setSkip((s) => s + limit)} />
      </Card>

      <EmployeeDetailPanel
        record={selected}
        isSelf={selected?._id === currentUser?.id}
        onUpdated={handleUpdated}
        onDeactivated={handleDeactivated}
      />

      <CreateEmployeeModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => { setRows((prev) => [created, ...prev]); setSelectedId(created._id); }} />
    </div>
  );
}

/* ============================================================================
 * ADMIN — Live attendance tracker
 * ==========================================================================*/

function AdminTracker() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      setRows(await api.attendance.today());
      setLastUpdated(new Date());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [load]);

  const counts = useMemo(() => {
    const c = { present: 0, work_from_home: 0, half_day: 0, on_leave: 0, absent: 0 };
    rows.forEach((r) => { if (c[r.status] !== undefined) c[r.status] += 1; });
    return c;
  }, [rows]);

  const filtered = rows.filter((r) => {
    const matchesSearch = !search || `${r.full_name} ${r.employee_id} ${r.department || ""}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard icon={Users} label="Total tracked" value={rows.length} tone="brand" />
        <StatCard icon={CheckCircle2} label="Present" value={counts.present} tone="emerald" />
        <StatCard icon={Home} label="Remote" value={counts.work_from_home} tone="brand" />
        <StatCard icon={Clock} label="Half day" value={counts.half_day} tone="accent" />
        <StatCard icon={Ban} label="Absent" value={counts.absent} tone="rose" />
      </div>

      <Card className="p-6">
        <SectionHeader
          eyebrow={lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : "Live"}
          title="Today's roster"
          description="Refreshes automatically every 30 seconds."
          action={<Button variant="outline" size="sm" icon={RefreshCw} onClick={() => load(false)}>Refresh</Button>}
        />

        <div className="mb-4 flex flex-wrap gap-2.5">
          <div className="flex-1 min-w-[200px]"><Input icon={Search} placeholder="Search employee, ID, or department…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(ATTENDANCE_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </Select>
        </div>

        {loading ? (
          <Spinner label="Loading today's attendance…" />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Fingerprint} title="No matching records" description="Adjust your search or status filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                  <th className="pb-3 pr-4">Employee</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Check in</th>
                  <th className="pb-3 pr-4">Check out</th>
                  <th className="pb-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r._id}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.full_name} size="sm" />
                        <div>
                          <p className="font-semibold text-ink-700">{r.full_name}</p>
                          <p className="font-mono text-[11.5px] text-ink-300">{r.employee_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-ink-500">{r.department || "—"}</td>
                    <td className="py-3 pr-4"><Badge meta={ATTENDANCE_META[r.status]} /></td>
                    <td className="py-3 pr-4 font-mono text-ink-500">{formatTime(r.check_in)}</td>
                    <td className="py-3 pr-4 font-mono text-ink-500">{formatTime(r.check_out)}</td>
                    <td className="py-3 text-ink-400">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================================
 * ADMIN — Leave approval workflow
 * ==========================================================================*/

function RejectModal({ open, onClose, onConfirm, loading }) {
  const [comment, setComment] = useState("");
  useEffect(() => { if (open) setComment(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Reject this request" description="Optionally tell the employee why." width="max-w-sm">
      <div className="flex flex-col gap-4">
        <Field label="Note to employee (optional)">
          <Textarea maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Please resubmit with manager sign-off." />
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="dangerFilled" loading={loading} onClick={() => onConfirm(comment)}>Reject request</Button>
        </div>
      </div>
    </Modal>
  );
}

function PendingLeaveCard({ leave, onApprove, onReject, busy }) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3.5">
        <Avatar name={leave.employee_id} size="md" />
        <div>
          <p className="text-[13.5px] font-semibold text-ink-700">{leave.employee_id}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge>{LEAVE_TYPE_LABELS[leave.leave_type]}</Badge>
            <span className="text-[12.5px] text-ink-400">{formatDate(leave.start_date)} — {formatDate(leave.end_date)} &middot; {leave.total_days} day{leave.total_days === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-1.5 max-w-md text-[12.5px] text-ink-500">"{leave.reason}"</p>
          <p className="mt-1 text-[11.5px] text-ink-300">Applied {relativeTime(leave.applied_on)}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2.5 self-start sm:self-center">
        <Button size="sm" variant="danger" icon={X} disabled={busy} onClick={() => onReject(leave)}>Reject</Button>
        <Button size="sm" variant="primary" icon={Check} loading={busy} onClick={() => onApprove(leave)}>Approve</Button>
      </div>
    </Card>
  );
}

function AdminLeaveApprovals() {
  const toast = useToast();
  const [tab, setTab] = useState("pending");
  const [pending, setPending] = useState([]);
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([
        api.leaves.list({ status: "pending", limit: 100 }),
        api.leaves.list({ limit: 150 }),
      ]);
      setPending(p);
      setAll(a);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(leave) {
    setBusyId(leave._id);
    try {
      await api.leaves.review(leave._id, { status: "approved" });
      toast.success(`Approved ${leave.employee_id}'s ${LEAVE_TYPE_LABELS[leave.leave_type].toLowerCase()}.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(comment) {
    const leave = rejectTarget;
    setBusyId(leave._id);
    try {
      await api.leaves.review(leave._id, { status: "rejected", review_comment: comment || null });
      toast.info(`Rejected ${leave.employee_id}'s request.`);
      setRejectTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const filteredAll = all.filter((lv) => (!statusFilter || lv.status === statusFilter) && (!employeeFilter || lv.employee_id.toLowerCase().includes(employeeFilter.toLowerCase())));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex rounded-xl bg-slate-100 p-1 sm:w-fit">
        <button onClick={() => setTab("pending")} className={cn("flex-1 rounded-lg px-5 py-2 text-[13px] font-semibold transition sm:flex-none", tab === "pending" ? "bg-white text-ink-700 shadow-sm" : "text-ink-400")}>
          Pending queue {pending.length > 0 && <span className="ml-1.5 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10.5px] text-white">{pending.length}</span>}
        </button>
        <button onClick={() => setTab("all")} className={cn("flex-1 rounded-lg px-5 py-2 text-[13px] font-semibold transition sm:flex-none", tab === "all" ? "bg-white text-ink-700 shadow-sm" : "text-ink-400")}>
          All requests
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading leave requests…" />
      ) : tab === "pending" ? (
        pending.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Inbox zero" description="No leave requests are waiting on your review right now." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((lv) => (
              <PendingLeaveCard key={lv._id} leave={lv} onApprove={handleApprove} onReject={setRejectTarget} busy={busyId === lv._id} />
            ))}
          </div>
        )
      ) : (
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap gap-2.5">
            <div className="min-w-[200px] flex-1"><Input icon={Search} placeholder="Filter by employee ID…" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} /></div>
            <Select className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(LEAVE_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </Select>
          </div>
          {filteredAll.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No leave requests found" description="Try clearing your filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                    <th className="pb-3 pr-4">Employee</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Dates</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Reviewed by</th>
                    <th className="pb-3">Applied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAll.map((lv) => (
                    <tr key={lv._id}>
                      <td className="py-3 pr-4 font-mono font-medium text-ink-600">{lv.employee_id}</td>
                      <td className="py-3 pr-4 text-ink-500">{LEAVE_TYPE_LABELS[lv.leave_type]}</td>
                      <td className="py-3 pr-4 text-ink-500">{formatDate(lv.start_date)} – {formatDate(lv.end_date)}</td>
                      <td className="py-3 pr-4"><Badge meta={LEAVE_STATUS_META[lv.status]} /></td>
                      <td className="py-3 pr-4 text-ink-400">{lv.reviewed_by || "—"}</td>
                      <td className="py-3 text-ink-400">{relativeTime(lv.applied_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <RejectModal open={!!rejectTarget} onClose={() => setRejectTarget(null)} onConfirm={handleReject} loading={!!busyId} />
    </div>
  );
}

/* ============================================================================
 * ADMIN — Payroll ledger
 * ==========================================================================*/

function GeneratePayrollModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const blank = { employee_id: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), basic_salary: "", allowances: "0", deductions: "0", tax: "0" };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setForm(blank); setError(""); } }, [open]); // eslint-disable-line

  const netPreview = (Number(form.basic_salary || 0) + Number(form.allowances || 0) - Number(form.deductions || 0) - Number(form.tax || 0));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api.payroll.create({
        employee_id: form.employee_id.trim(),
        month: Number(form.month),
        year: Number(form.year),
        basic_salary: Number(form.basic_salary),
        allowances: Number(form.allowances || 0),
        deductions: Number(form.deductions || 0),
        tax: Number(form.tax || 0),
      });
      toast.success(`Payslip generated for ${created.employee_id}.`);
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate a payslip" description="Net pay is always recalculated server-side." width="max-w-md">
      {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Employee ID" required>
          <Input required placeholder="EMP-1042" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Month" required>
            <Select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
              {MONTH_LABELS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year" required>
            <Input type="number" required min={2000} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </Field>
        </div>
        <Field label="Basic salary (₹)" required>
          <Input type="number" required min={0} step="0.01" value={form.basic_salary} onChange={(e) => setForm({ ...form, basic_salary: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Allowances (₹)">
            <Input type="number" min={0} step="0.01" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} />
          </Field>
          <Field label="Deductions (₹)">
            <Input type="number" min={0} step="0.01" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
          </Field>
          <Field label="Tax (₹)">
            <Input type="number" min={0} step="0.01" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-[12.5px] font-medium text-ink-500">
          <span>Estimated net pay</span>
          <span className="font-mono font-semibold text-ink-700">{formatMoney(netPreview)}</span>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Plus} loading={saving}>Generate</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditPayrollModal({ record, onClose, onUpdated }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (record) setForm({ allowances: record.allowances, deductions: record.deductions, tax: record.tax, status: record.status });
    setError("");
  }, [record]);

  if (!record || !form) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await api.payroll.update(record._id, {
        allowances: Number(form.allowances),
        deductions: Number(form.deductions),
        tax: Number(form.tax),
        status: form.status,
      });
      toast.success("Payslip updated.");
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!record} onClose={onClose} title={`Adjust ${record.employee_id}'s payslip`} description={`${MONTH_LABELS[record.month - 1]} ${record.year}`} width="max-w-sm">
      {error && <div className="mb-4"><InlineAlert variant="error">{error}</InlineAlert></div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Basic salary (₹)" hint="Locked after generation">
          <Input value={formatMoney(record.basic_salary)} disabled />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Allowances (₹)">
            <Input type="number" min={0} step="0.01" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} />
          </Field>
          <Field label="Deductions (₹)">
            <Input type="number" min={0} step="0.01" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
          </Field>
        </div>
        <Field label="Tax (₹)">
          <Input type="number" min={0} step="0.01" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(PAYROLL_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Save} loading={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function AdminPayroll() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.payroll.list({ employee_id: employeeFilter || undefined, status: statusFilter || undefined, limit: 150 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [employeeFilter, statusFilter, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.payroll.remove(deleteTarget._id);
      toast.success("Payroll record removed.");
      setRows((prev) => prev.filter((r) => r._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  const totalNet = rows.reduce((sum, r) => sum + r.net_salary, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Landmark} label="Records shown" value={rows.length} tone="brand" />
        <StatCard icon={IndianRupee} label="Total net (filtered)" value={formatMoney(totalNet)} tone="emerald" />
        <StatCard icon={Clock} label="Pending payouts" value={rows.filter((r) => r.status === "pending").length} tone="accent" />
      </div>

      <Card className="p-6">
        <SectionHeader eyebrow="Ledger" title="Payroll records" description="Generate, adjust, and settle employee payslips." action={<Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>Generate payslip</Button>} />

        <div className="mb-4 flex flex-wrap gap-2.5">
          <div className="min-w-[200px] flex-1"><Input icon={Search} placeholder="Filter by employee ID…" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} /></div>
          <Select className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(PAYROLL_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </Select>
        </div>

        {loading ? (
          <Spinner label="Loading payroll ledger…" />
        ) : rows.length === 0 ? (
          <EmptyState icon={Landmark} title="No payroll records" description="Generate the first payslip to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                  <th className="pb-3 pr-4">Employee</th>
                  <th className="pb-3 pr-4">Period</th>
                  <th className="pb-3 pr-4">Net pay</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="py-3 pr-4 font-mono font-medium text-ink-600">{r.employee_id}</td>
                    <td className="py-3 pr-4 text-ink-500">{MONTH_LABELS[r.month - 1]} {r.year}</td>
                    <td className="py-3 pr-4 font-mono font-semibold text-ink-700">{formatMoney(r.net_salary)}</td>
                    <td className="py-3 pr-4"><Badge meta={PAYROLL_STATUS_META[r.status]} /></td>
                    <td className="py-3">
                      <div className="flex gap-1.5">
                        <IconButton icon={Pencil} label="Edit" onClick={() => setEditTarget(r)} />
                        <IconButton icon={Trash2} label="Delete" className="hover:bg-rose-50 hover:text-rose-600" onClick={() => setDeleteTarget(r)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <GeneratePayrollModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => setRows((prev) => [created, ...prev])} />
      <EditPayrollModal record={editTarget} onClose={() => setEditTarget(null)} onUpdated={(updated) => setRows((prev) => prev.map((r) => (r._id === updated._id ? updated : r)))} />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete this payroll record?"
        description={deleteTarget ? `This permanently removes ${deleteTarget.employee_id}'s payslip for ${MONTH_LABELS[deleteTarget.month - 1]} ${deleteTarget.year}.` : ""}
        confirmLabel="Delete record"
      />
    </div>
  );
}

/* ============================================================================
 * ROOT APP
 * ==========================================================================*/

function AppShell() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-700">
            <Fingerprint size={22} className="text-accent-400" />
          </div>
          <Loader2 size={18} className="animate-spin text-brand-400" />
        </div>
      </div>
    );
  }

  if (status === "guest") return <AuthScreen />;

  return <RoleRouter />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ToastProvider>
  );
}
