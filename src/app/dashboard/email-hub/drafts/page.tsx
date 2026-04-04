"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { emitLeadEvent } from "@/lib/lead-events";

type EmailDraftStatus = "drafted" | "approved" | "sent" | "discarded";
type TrainingCategory =
  | "initial_inquiry"
  | "follow_up"
  | "scheduling"
  | "agent_handoff"
  | "pricing"
  | "objection"
  | "general";

interface AgentInfo {
  id: string;
  name: string;
  email: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
}

interface EmailDraft {
  id: string;
  thread_id: string | null;
  email_account_id: string | null;
  provider_draft_id: string | null;
  status: EmailDraftStatus;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  cc_emails: string[];
  agent_handoff_id: string | null;
  agents: AgentInfo | null;
  is_simulation: boolean;
  simulation_input: Record<string, unknown> | null;
  sent_body_text: string | null;
  was_changed: boolean;
  agent_handoff_transferred: boolean;
  added_to_training: boolean;
  lead_status_update: string | null;
  salesforce_owner_name: string | null;
  is_master_agent_owned: boolean | null;
  sender_name: string | null;
  sender_email: string | null;
  salesforce_lead_status: string | null;
  account_email: string | null;
  account_display_name: string | null;
  preview_text: string | null;
  response_time_ms: number | null;
  created_at: string;
  edited_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
}

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string | null;
  created_at: string;
}

const STATUS_OPTIONS: { key: EmailDraftStatus; label: string }[] = [
  { key: "drafted", label: "Drafts" },
  { key: "sent", label: "Sent" },
];

const STATUS_COLORS: Record<EmailDraftStatus, string> = {
  drafted: "#4f8ff7",
  approved: "#34d399",
  sent: "#34d399",
  discarded: "#f87171",
};

const CATEGORY_OPTIONS: { key: TrainingCategory; label: string }[] = [
  { key: "initial_inquiry", label: "Initial Inquiry" },
  { key: "follow_up", label: "Follow Up" },
  { key: "scheduling", label: "Scheduling" },
  { key: "agent_handoff", label: "Agent Handoff" },
  { key: "pricing", label: "Pricing" },
  { key: "objection", label: "Objection Handling" },
  { key: "general", label: "General" },
];

/** Play a sound effect */
function playSound(src: string) {
  const audio = new Audio(src);
  audio.volume = 0.6;
  audio.play().catch(() => {});
}

/** Per-inbox background tint colors (very subtle) */
const INBOX_TINT: Record<string, string> = {
  "lynn@lifeatlakewood.com": "rgba(168, 130, 255, 0.06)",   // purple
  "lynn@lifeinwellenpark.com": "rgba(52, 211, 153, 0.06)",  // green
  "lynn@lifeatparrish.com": "rgba(34, 211, 238, 0.06)",     // cyan
  "lynn@lifeinlongboatkey.com": "rgba(250, 204, 21, 0.06)", // yellow
};

/** Accent color for inbox left-border highlight */
const INBOX_ACCENT: Record<string, string> = {
  "lynn@lifeatlakewood.com": "rgba(168, 130, 255, 0.35)",
  "lynn@lifeinwellenpark.com": "rgba(52, 211, 153, 0.35)",
  "lynn@lifeatparrish.com": "rgba(34, 211, 238, 0.35)",
  "lynn@lifeinlongboatkey.com": "rgba(250, 204, 21, 0.35)",
};

const POLL_INTERVAL_MS = 15_000;

/**
 * Format a date for the email list: show time (Eastern) for today, date for older.
 */
function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  const eastern = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

  const isToday =
    eastern.getFullYear() === nowEastern.getFullYear() &&
    eastern.getMonth() === nowEastern.getMonth() &&
    eastern.getDate() === nowEastern.getDate();

  if (isToday) {
    return date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format response time from milliseconds to a human-readable string.
 */
function formatResponseTime(ms: number): string {
  if (ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const totalHr = Math.floor(totalMin / 60);
  const totalDay = Math.floor(totalHr / 24);

  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `${totalMin}m`;
  if (totalHr < 24) {
    const remainMin = totalMin % 60;
    return remainMin > 0 ? `${totalHr}h ${remainMin}m` : `${totalHr}h`;
  }
  const remainHr = totalHr % 24;
  return remainHr > 0 ? `${totalDay}d ${remainHr}h` : `${totalDay}d`;
}

/**
 * Minimal MD5 implementation for Gravatar URLs.
 */
function md5(input: string): string {
  function rotl(v: number, s: number) { return (v << s) | (v >>> (32 - s)); }
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391
  ];
  const S = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
  ];
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) { bytes.push(192 | (c >> 6)); bytes.push(128 | (c & 63)); }
    else { bytes.push(224 | (c >> 12)); bytes.push(128 | ((c >> 6) & 63)); bytes.push(128 | (c & 63)); }
  }
  const origLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((origLen >>> (i * 8)) & 0xff);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < bytes.length; i += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      M[j] = bytes[i+j*4] | (bytes[i+j*4+1]<<8) | (bytes[i+j*4+2]<<16) | (bytes[i+j*4+3]<<24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5*j+1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3*j+5) % 16; }
      else { F = C ^ (B | ~D); g = (7*j) % 16; }
      F = (F + A + K[j] + M[g]) | 0;
      A = D; D = C; C = B; B = (B + rotl(F, S[j])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  let hex = '';
  for (const v of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) hex += ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

function gravatarUrl(email: string, size = 40): string {
  return `https://www.gravatar.com/avatar/${md5(email.trim().toLowerCase())}?s=${size}&d=404`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Strip quoted reply text from a sent email body for display.
 */
function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{3,}\s*(Original Message|Forwarded message)/i.test(line.trim())) break;
    if (/^_{3,}/.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    result.push(line);
  }
  return result.join("\n").trim();
}

function EmailDraftsPageInner() {
  const searchParams = useSearchParams();
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EmailDraftStatus>("drafted");

  // Reset to Drafts tab when navigating here via sidebar (no tab param or tab=drafted)
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (!tab || tab === "drafted") {
      setStatusFilter("drafted");
    }
  }, [searchParams]);
  const [showSimulations] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Thread messages for the expanded draft
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCcAgent, setEditCcAgent] = useState<AgentOption | null>(null);
  const [saving, setSaving] = useState(false);

  // Agents list for CC dropdown
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [approveResult, setApproveResult] = useState<string | null>(null);

  // Reminder state
  const [remindingId, setRemindingId] = useState<string | null>(null);

  // Discard state
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  // Add to training state
  const [trainingDraftId, setTrainingDraftId] = useState<string | null>(null);
  const [trainingCategory, setTrainingCategory] = useState<TrainingCategory>("general");
  const [addingToTraining, setAddingToTraining] = useState(false);

  // Agent handoff state
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffResult, setHandoffResult] = useState<string | null>(null);
  const [handoffPickerDraftId, setHandoffPickerDraftId] = useState<string | null>(null);
  const [handoffSelectedAgentId, setHandoffSelectedAgentId] = useState<string | null>(null);

  // Lead status update state
  const [leadStatusUpdatingId, setLeadStatusUpdatingId] = useState<string | null>(null);

  // Regenerate state
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  // Auto-approve state
  const [autoApprove, setAutoApprove] = useState(false);
  const [togglingAutoApprove, setTogglingAutoApprove] = useState(false);
  const [autoApproveSchedule, setAutoApproveSchedule] = useState<string | null>(null);

  // Rescan state
  const [rescanning, setRescanning] = useState(false);
  const [rescanResult, setRescanResult] = useState<string | null>(null);


  const fetchDrafts = useCallback(
    (isPolling = false) => {
      if (!isPolling) setLoading(true);
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("is_simulation", String(showSimulations));
      params.set("limit", "50");

      fetch(`/api/internal/email-hub/drafts?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setDrafts(data);
            // Update approved set from fetched data
            const newApproved = new Set(approvedIds);
            data.forEach((d: EmailDraft) => {
              if (d.status === "approved") newApproved.add(d.id);
            });
            setApprovedIds(newApproved);
          } else if (!isPolling) {
            setError(data.error ?? "Failed to load drafts");
          }
          if (!isPolling) setLoading(false);
        })
        .catch((e) => {
          if (!isPolling) {
            setError(e.message);
            setLoading(false);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFilter, showSimulations]
  );

  // Initial fetch on filter change — also reset inbox expansion
  useEffect(() => {
    setInboxShowCount(new Map());
    fetchDrafts();
  }, [fetchDrafts]);

  // Load agents for CC dropdown
  useEffect(() => {
    fetch("/api/internal/agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(
            data
              .filter((a: AgentOption & { is_active: boolean }) => a.is_active && a.email)
              .map((a: AgentOption) => ({ id: a.id, name: a.name, email: a.email }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Load auto-approve setting
  useEffect(() => {
    fetch("/api/internal/email-hub/auto-approve")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.enabled === "boolean") setAutoApprove(data.enabled);
        if (data.scheduleTime !== undefined) setAutoApproveSchedule(data.scheduleTime);
      })
      .catch(() => {});
  }, []);

  async function toggleAutoApprove() {
    setTogglingAutoApprove(true);
    try {
      const res = await fetch("/api/internal/email-hub/auto-approve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !autoApprove }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoApprove(data.enabled);
      }
    } catch {
      // Silently fail
    } finally {
      setTogglingAutoApprove(false);
    }
  }

  async function updateAutoApproveSchedule(time: string | null) {
    setAutoApproveSchedule(time);
    try {
      await fetch("/api/internal/email-hub/auto-approve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleTime: time }),
      });
    } catch {
      // Silently fail
    }
  }

  async function handleRescan() {
    setRescanning(true);
    setRescanResult(null);
    try {
      const res = await fetch("/api/internal/email-hub/rescan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "Rescan failed");
      setRescanResult(
        data.draftsGenerated > 0
          ? `Found ${data.draftsGenerated} missed draft${data.draftsGenerated > 1 ? "s" : ""} — generating now.`
          : `Scanned ${data.threadsScanned} threads — no missed drafts found.`
      );
      if (data.draftsGenerated > 0) fetchDrafts(true);
    } catch (e) {
      setRescanResult(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
      setTimeout(() => setRescanResult(null), 8000);
    }
  }

  // Polling (15s interval)
  const fetchDraftsRef = useRef(fetchDrafts);
  fetchDraftsRef.current = fetchDrafts;
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDraftsRef.current(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function loadThreadMessages(draftId: string) {
    setLoadingThread(true);
    setThreadMessages([]);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}`);
      const data = await res.json();
      setThreadMessages(data.thread_messages ?? []);
    } catch {
      // Thread loading is non-critical
    } finally {
      setLoadingThread(false);
    }
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
      setThreadMessages([]);
      setTrainingDraftId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
      setTrainingDraftId(null);
      loadThreadMessages(id);
    }
  }

  function startEditing(draft: EmailDraft) {
    setEditingId(draft.id);
    setEditText(draft.body_text ?? "");
    // Restore existing CC agent if one was set
    if (draft.cc_emails.length > 0) {
      const existing = agents.find(
        (a) => a.email && draft.cc_emails.some((cc) => cc.toLowerCase() === a.email!.toLowerCase())
      );
      setEditCcAgent(existing ?? null);
    } else {
      setEditCcAgent(null);
    }
  }

  function cancelEditing() {
    setEditingId(null);
    setEditText("");
    setEditCcAgent(null);
  }

  async function saveEdit(draft: EmailDraft) {
    setSaving(true);
    try {
      const ccEmails = editCcAgent?.email ? [editCcAgent.email] : [];
      const res = await fetch(`/api/internal/email-hub/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_text: editText, cc_emails: ccEmails }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setEditingId(null);
      setEditText("");
      setEditCcAgent(null);
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function approveDraft(draftId: string) {
    setApprovingId(draftId);
    setApproveResult(null);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Approval failed");
      }
      // Mark as approved in local state
      setApprovedIds((prev) => new Set(prev).add(draftId));
      setApproveResult(
        "Approved! An SMS has been sent to frontlines to review and send."
      );

      // Play draft-approved sound
      const approvedAudio = new Audio("/sounds/draft-approved.wav");
      approvedAudio.volume = 0.6;
      approvedAudio.play().catch(() => {});

      // If SMS was sent to frontlines, play codec sound and have Snake speak
      if (data.sms_sent) {
        setTimeout(() => {
          const codecAudio = new Audio("/sounds/mgs-codec.mp3");
          codecAudio.volume = 0.6;
          codecAudio.play().catch(() => {});
          emitLeadEvent({ type: "email_draft_approved", leadName: "" });
        }, 1500);
      }

      fetchDrafts();
    } catch (e) {
      setApproveResult(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  }

  async function sendReminder(draftId: string) {
    setRemindingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/remind`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reminder failed");
      setApproveResult("Reminder sent!");

      const approvedAudio = new Audio("/sounds/draft-approved.wav");
      approvedAudio.volume = 0.6;
      approvedAudio.play().catch(() => {});
    } catch (e) {
      setApproveResult(e instanceof Error ? e.message : "Reminder failed");
    } finally {
      setRemindingId(null);
    }
  }

  async function discardDraft(draftId: string) {
    if (!confirm("Are you sure you want to discard this draft? This will also delete it from Gmail.")) return;
    setDiscardingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "discarded" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to discard");
      }
      playSound("/sounds/discard-draft-sound.mp3");
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setDiscardingId(null);
    }
  }

  async function addToTraining(draftId: string) {
    setAddingToTraining(true);
    try {
      const res = await fetch(
        `/api/internal/email-hub/drafts/${draftId}/add-to-training`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: trainingCategory }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to add to training");
      }
      setTrainingDraftId(null);
      // Optimistically update the local draft to reflect training status
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === draftId ? { ...d, added_to_training: true } : d
        )
      );
      alert("Added to training data successfully!");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add to training");
    } finally {
      setAddingToTraining(false);
    }
  }

  async function triggerAgentHandoff(draftId: string, agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
    const agentName = agent?.name ?? "Agent";
    if (!confirm(`Transfer this lead to ${agentName} in Salesforce? This will update Salesforce via Zapier.`)) return;
    setHandoffId(draftId);
    setHandoffResult(null);
    setHandoffPickerDraftId(null);
    setHandoffSelectedAgentId(null);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Handoff failed");
      }
      playSound("/sounds/transfer-to-agent-sound.mp3");
      setHandoffResult(`Transferred to ${agentName} successfully!`);
      fetchDrafts();
    } catch (e) {
      setHandoffResult(e instanceof Error ? e.message : "Handoff failed");
    } finally {
      setHandoffId(null);
    }
  }

  async function updateLeadStatus(draftId: string, status: "nurture_active" | "disqualified") {
    const label = status === "nurture_active" ? "Nurture Active" : "Disqualified";
    if (!confirm(`Update this lead to ${label} in Salesforce?`)) return;
    setLeadStatusUpdatingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/lead-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Update failed");
      }
      playSound(status === "nurture_active"
        ? "/sounds/nurture-active-sound.mp3"
        : "/sounds/update-to-disqualified.mp3");
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Lead status update failed");
    } finally {
      setLeadStatusUpdatingId(null);
    }
  }

  async function regenerateDraft(draftId: string) {
    if (!confirm("Generate a new AI draft? This will replace the current draft text.")) return;
    setRegeneratingId(draftId);
    try {
      const res = await fetch(`/api/internal/email-hub/drafts/${draftId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Regeneration failed");
      }
      fetchDrafts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegeneratingId(null);
    }
  }

  const filteredDrafts = drafts;

  // Group drafts by inbox (email_account_id)
  const groupedByInbox = filteredDrafts.reduce<Record<string, { label: string; drafts: EmailDraft[] }>>((acc, draft) => {
    const key = draft.account_email ?? "unknown";
    if (!acc[key]) {
      acc[key] = {
        label: draft.account_display_name ?? draft.account_email ?? "Unknown Inbox",
        drafts: [],
      };
    }
    acc[key].drafts.push(draft);
    return acc;
  }, {});
  const inboxGroups = Object.entries(groupedByInbox);

  // Track how many emails to show per inbox (default: 5, load more adds another 5)
  const INBOX_PAGE_SIZE = 5;
  const [inboxShowCount, setInboxShowCount] = useState<Map<string, number>>(new Map());

  // Track which inbox sections are fully collapsed (header only)
  const [collapsedInboxes, setCollapsedInboxes] = useState<Set<string>>(new Set());
  function toggleInboxCollapse(key: string) {
    setCollapsedInboxes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Track gravatar load failures
  const [failedGravatars, setFailedGravatars] = useState<Set<string>>(new Set());

  // Reusable thread messages renderer (newest on top)
  function renderThreadMessages() {
    if (loadingThread) {
      return (
        <div style={{ marginBottom: 16 }}>
          <p className="text-muted text-sm">Loading conversation...</p>
        </div>
      );
    }
    if (threadMessages.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <label
          className="text-sm"
          style={{
            display: "block",
            fontWeight: 600,
            marginBottom: 10,
            color: "#8b8fa3",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Conversation Thread
        </label>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 400,
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          {threadMessages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            return (
              <div
                key={msg.id}
                style={{
                  background: isInbound ? "#1a1d27" : "#1a2633",
                  border: `1px solid ${isInbound ? "#2a2e3a" : "#1e3a5f"}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isInbound ? "#f87171" : "#34d399",
                    }}
                  >
                    {isInbound ? "Inbound" : "Outbound"}{" "}
                    <span style={{ color: "#8b8fa3", fontWeight: 400 }}>
                      {msg.from_email ?? ""}
                    </span>
                  </span>
                  {msg.received_at && (
                    <span className="text-muted text-sm">
                      {formatRelativeDate(msg.received_at)}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "#e4e6ed",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.body_text ?? "(empty)"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Email Drafts</h2>
        <p>Review, edit, and approve AI-generated email drafts.</p>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "12px 16px",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`btn ${statusFilter === opt.key ? "btn-primary" : "btn-secondary"}`}
                onClick={() => {
                  setStatusFilter(opt.key);
                  setExpandedId(null);
                  setApproveResult(null);
                  setHandoffResult(null);
                }}
                style={{ padding: "6px 14px", fontSize: 13 }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Auto-Approve toggle + schedule — pushed to right */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={toggleAutoApprove}
              disabled={togglingAutoApprove}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                color: autoApprove ? "#34d399" : "#8b8fa3",
                background: autoApprove ? "rgba(52, 211, 153, 0.1)" : "transparent",
                border: `1px solid ${autoApprove ? "#34d399" : "#2a2e3a"}`,
                borderRadius: 6,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 32,
                height: 18,
                borderRadius: 9,
                background: autoApprove ? "#34d399" : "#2a2e3a",
                position: "relative",
                transition: "background 0.2s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: autoApprove ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s",
                }}
              />
            </span>
            Auto-Approve
          </button>

          {/* Auto-approve daily schedule */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label
              style={{
                fontSize: 12,
                color: "#8b8fa3",
                whiteSpace: "nowrap",
              }}
            >
              Turn on daily at
            </label>
            <input
              type="time"
              value={autoApproveSchedule ?? ""}
              onChange={(e) => updateAutoApproveSchedule(e.target.value || null)}
              style={{
                padding: "4px 8px",
                fontSize: 12,
                background: "#1a1d27",
                border: "1px solid #2a2e3a",
                borderRadius: 4,
                color: "#e4e6ed",
              }}
            />
            {autoApproveSchedule && (
              <button
                onClick={() => updateAutoApproveSchedule(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#8b8fa3",
                  fontSize: 14,
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
                title="Clear schedule"
              >
                &#10005;
              </button>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Re-scan Inboxes button */}
      {statusFilter === "drafted" && (
        <div className="rescan-row" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {rescanResult && (
            <span
              style={{
                fontSize: 13,
                color: rescanResult.includes("missed") ? "#34d399" : "#8b8fa3",
                padding: "6px 12px",
                background: rescanResult.includes("missed") ? "rgba(52, 211, 153, 0.08)" : "rgba(139, 143, 163, 0.08)",
                borderRadius: 6,
              }}
            >
              {rescanResult}
            </span>
          )}
          <button
            onClick={handleRescan}
            disabled={rescanning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: "#8b8fa3",
              background: "transparent",
              border: "1px solid #2a2e3a",
              borderRadius: 6,
              cursor: rescanning ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              opacity: rescanning ? 0.6 : 1,
            }}
          >
            {rescanning ? (
              <span style={{
                display: "inline-block",
                width: 12,
                height: 12,
                border: "2px solid #2a2e3a",
                borderTop: "2px solid #8b8fa3",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            )}
            {rescanning ? "Scanning..." : "Re-Scan Inboxes"}
          </button>
        </div>
      )}

      {/* Error state */}
      {error ? (
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="empty-state">
            <p>Loading drafts...</p>
          </div>
        </div>
      ) : filteredDrafts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">&#9993;</div>
            <h3>No drafts found</h3>
            <p>
              {statusFilter === "drafted"
                ? "No pending drafts. New drafts will appear here when emails are received."
                : "No sent emails found."}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {inboxGroups.map(([inboxKey, group]) => (
            <div key={inboxKey}>
              {/* Inbox section header — click to collapse/expand */}
              {inboxGroups.length > 1 && (
                <div
                  onClick={() => toggleInboxCollapse(inboxKey)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: collapsedInboxes.has(inboxKey) ? 0 : 12,
                    padding: "8px 12px",
                    background: INBOX_TINT[inboxKey] ?? "#1a1d27",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    borderLeft: INBOX_ACCENT[inboxKey]
                      ? `3px solid ${INBOX_ACCENT[inboxKey]}`
                      : "1px solid var(--border)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span style={{
                    fontSize: 12,
                    color: "#8b8fa3",
                    transition: "transform 0.2s",
                    transform: collapsedInboxes.has(inboxKey) ? "rotate(-90deg)" : "rotate(0deg)",
                  }}>
                    &#9660;
                  </span>
                  <span style={{ fontSize: 20, color: "#e4e6ed" }}>&#9993;</span>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#e4e6ed",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {group.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#8b8fa3",
                      background: "#252830",
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontWeight: 600,
                    }}
                  >
                    {group.drafts.length}
                  </span>
                </div>
              )}

              {!collapsedInboxes.has(inboxKey) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {group.drafts.slice(0, inboxShowCount.get(inboxKey) ?? INBOX_PAGE_SIZE).map((draft) => {
                  const isExpanded = expandedId === draft.id;
                  const isEditing = editingId === draft.id;
                  const isApproved = draft.status === "approved" || approvedIds.has(draft.id);
                  const statusColor = isApproved ? "#34d399" : STATUS_COLORS[draft.status];
                  const isSent = draft.status === "sent";
                  const displayStatus = isApproved ? "approved" : draft.status;
                  const senderEmail = draft.sender_email ?? "";
                  const senderName = draft.sender_name ?? senderEmail.split("@")[0] ?? "Unknown";
                  const hasGravatar = senderEmail && !failedGravatars.has(senderEmail);

                  // Resolve CC'd agent names for display
                  const ccAgentNames = draft.cc_emails.map((cc) => {
                    const match = agents.find(
                      (a) => a.email && a.email.toLowerCase() === cc.toLowerCase()
                    );
                    return match ? match.name : null;
                  });

                  // Determine the time to display
                  const displayTime = isSent && draft.sent_at
                    ? formatEmailDate(draft.sent_at)
                    : formatEmailDate(draft.created_at);

                  return (
                    <div className="card" key={draft.id} style={{
                      overflow: "hidden",
                      background: INBOX_TINT[draft.account_email ?? ""] ?? undefined,
                      borderLeft: INBOX_ACCENT[draft.account_email ?? ""]
                        ? `3px solid ${INBOX_ACCENT[draft.account_email ?? ""]}`
                        : undefined,
                    }}>
                      {/* Collapsed row — Gmail-style */}
                      <div
                        onClick={() => toggleExpand(draft.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 16px",
                          cursor: "pointer",
                        }}
                      >
                        {/* Gravatar circle */}
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "#2a2e3a",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#8b8fa3",
                          }}
                        >
                          {hasGravatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={gravatarUrl(senderEmail, 72)}
                              alt=""
                              width={36}
                              height={36}
                              style={{ borderRadius: "50%", display: "block" }}
                              onError={() => {
                                setFailedGravatars((prev) => new Set(prev).add(senderEmail));
                              }}
                            />
                          ) : (
                            senderName.charAt(0).toUpperCase()
                          )}
                        </div>

                        {/* Name + Subject + Preview */}
                        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {/* Sender name */}
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: "#e4e6ed",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                            >
                              {senderName}
                            </span>

                            {/* Status badge */}
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 7px",
                                borderRadius: 10,
                                fontSize: 10,
                                fontWeight: 600,
                                background: `${statusColor}22`,
                                color: statusColor,
                                border: `1px solid ${statusColor}44`,
                                textTransform: "capitalize",
                                flexShrink: 0,
                              }}
                            >
                              {displayStatus}
                            </span>

                            {/* Ownership badge */}
                            {!draft.agent_handoff_transferred &&
                              draft.salesforce_owner_name &&
                              draft.is_master_agent_owned === false && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#fbbf2422",
                                  color: "#fbbf24",
                                  border: "1px solid #fbbf2444",
                                  flexShrink: 0,
                                }}
                              >
                                Owned by {draft.salesforce_owner_name}
                              </span>
                            )}

                            {/* CC badge */}
                            {draft.cc_emails.length > 0 && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#8b8fa311",
                                  color: "#8b8fa3",
                                  border: "1px solid #8b8fa333",
                                  flexShrink: 0,
                                }}
                              >
                                CC: {ccAgentNames.map((name, i) => name ?? draft.cc_emails[i]).join(", ")}
                              </span>
                            )}

                            {/* Added to Training label */}
                            {isSent && draft.added_to_training && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#34d39922",
                                  color: "#34d399",
                                  border: "1px solid #34d39944",
                                  flexShrink: 0,
                                }}
                              >
                                Trained
                              </span>
                            )}

                            {/* Lead status labels */}
                            {draft.lead_status_update === "nurture_active" && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#34d39922",
                                  color: "#34d399",
                                  border: "1px solid #34d39944",
                                  flexShrink: 0,
                                }}
                              >
                                Nurture Active
                              </span>
                            )}
                            {draft.lead_status_update === "disqualified" && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#f8717122",
                                  color: "#f87171",
                                  border: "1px solid #f8717144",
                                  flexShrink: 0,
                                }}
                              >
                                Disqualified
                              </span>
                            )}

                            {/* Handoff badge (last in label group) */}
                            {isSent && draft.agent_handoff_transferred && (
                              <span
                                style={{
                                  padding: "1px 7px",
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#a78bfa22",
                                  color: "#a78bfa",
                                  border: "1px solid #a78bfa44",
                                  flexShrink: 0,
                                }}
                              >
                                Handed Off
                              </span>
                            )}
                          </div>

                          {/* Subject + preview on second line */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: 6,
                              marginTop: 2,
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#c8cad3",
                                flexShrink: 0,
                              }}
                            >
                              {draft.is_simulation ? (
                                <span style={{ color: "#a78bfa" }}>Simulation Draft</span>
                              ) : (
                                draft.subject ?? "Untitled Draft"
                              )}
                            </span>
                            {draft.preview_text && (
                              <>
                                <span style={{ color: "#4a4e5a", flexShrink: 0 }}>—</span>
                                <span
                                  style={{
                                    fontSize: 12,
                                    color: "#6b7084",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {draft.preview_text}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Right side: response time + date */}
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            flexShrink: 0,
                            gap: 2,
                          }}
                        >
                          <span style={{ fontSize: 12, color: "#8b8fa3", whiteSpace: "nowrap" }}>
                            {displayTime}
                          </span>
                          {isSent && draft.response_time_ms != null && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: draft.response_time_ms <= 300000 ? "#34d399" : draft.response_time_ms <= 600000 ? "#fbbf24" : "#f87171",
                                background: draft.response_time_ms <= 300000 ? "#34d39911" : draft.response_time_ms <= 600000 ? "#fbbf2411" : "#f8717111",
                                padding: "1px 6px",
                                borderRadius: 8,
                                whiteSpace: "nowrap",
                              }}
                            >
                              replied in {formatResponseTime(draft.response_time_ms)}
                            </span>
                          )}
                        </div>
                      </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid #2a2e3a",
                      padding: "16px",
                    }}
                  >
                    {/* Simulation input */}
                    {draft.is_simulation && draft.simulation_input && (
                      <div style={{ marginBottom: 16 }}>
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 6,
                            color: "#a78bfa",
                          }}
                        >
                          Inbound Email (Simulation Input)
                        </label>
                        <div
                          style={{
                            background: "#111318",
                            border: "1px solid #2a2e3a",
                            borderRadius: 6,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "#e4e6ed",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 200,
                            overflowY: "auto",
                          }}
                        >
                          {typeof draft.simulation_input.inbound_email === "string"
                            ? draft.simulation_input.inbound_email
                            : JSON.stringify(draft.simulation_input, null, 2)}
                        </div>
                      </div>
                    )}

                    {/* Draft/Sent body */}
                    <div style={{ marginBottom: 16 }}>
                      <label
                        className="text-sm"
                        style={{
                          display: "block",
                          fontWeight: 600,
                          marginBottom: 6,
                          color: "#e4e6ed",
                        }}
                      >
                        {isSent ? "Sent Response" : "Draft Body"}
                      </label>

                      {isEditing ? (
                        <div>
                          <textarea
                            className="form-input"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            style={{
                              width: "100%",
                              minHeight: 200,
                              fontFamily: "inherit",
                              fontSize: 13,
                              lineHeight: 1.6,
                              resize: "vertical",
                            }}
                          />
                          {/* CC an Agent */}
                          <div style={{ marginTop: 10 }}>
                            <label
                              className="text-sm"
                              style={{
                                display: "block",
                                fontWeight: 600,
                                marginBottom: 4,
                                color: "#8b8fa3",
                              }}
                            >
                              CC an Agent
                            </label>
                            {editCcAgent ? (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "6px 12px",
                                  borderRadius: 16,
                                  background: "#a78bfa22",
                                  border: "1px solid #a78bfa44",
                                  color: "#a78bfa",
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                {editCcAgent.name}
                                <button
                                  onClick={() => setEditCcAgent(null)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#a78bfa",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: 16,
                                    lineHeight: 1,
                                  }}
                                  title="Remove"
                                >
                                  &times;
                                </button>
                              </div>
                            ) : (
                              <select
                                className="form-input"
                                value=""
                                onChange={(e) => {
                                  const agent = agents.find((a) => a.id === e.target.value);
                                  if (agent) setEditCcAgent(agent);
                                }}
                                style={{ width: "100%", fontSize: 13 }}
                              >
                                <option value="">Select an agent...</option>
                                {agents.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name} ({a.email})
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 10,
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="btn btn-secondary"
                              onClick={cancelEditing}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn-primary"
                              onClick={() => saveEdit(draft)}
                              disabled={saving}
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: "#111318",
                            border: "1px solid #2a2e3a",
                            borderRadius: 6,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "#e4e6ed",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 400,
                            overflowY: "auto",
                          }}
                        >
                          {isSent
                            ? stripQuotedText(draft.sent_body_text ?? draft.body_text ?? "(empty)")
                            : (draft.body_text ?? "(empty)")}
                        </div>
                      )}
                    </div>

                    {/* Was changed indicator - only shown on Drafts tab (not Sent) */}
                    {!isSent && draft.was_changed && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "8px 12px",
                          background: "#fbbf2411",
                          border: "1px solid #fbbf2433",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#fbbf24",
                        }}
                      >
                        The sent version was modified from the original AI draft.
                      </div>
                    )}

                    {/* Action buttons */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                        marginBottom: 16,
                      }}
                    >
                      {/* Edit button - only for non-sent, non-discarded, non-approved drafts, hidden when editing */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(draft);
                          }}
                        >
                          Edit Draft
                        </button>
                      )}

                      {/* Generate New Draft button - only for non-sent, non-discarded, non-approved drafts, hidden when editing */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            regenerateDraft(draft.id);
                          }}
                          disabled={regeneratingId === draft.id}
                          style={{
                            color: "#4f8ff7",
                            borderColor: "#4f8ff744",
                          }}
                        >
                          {regeneratingId === draft.id ? "Generating..." : "Generate New Draft"}
                        </button>
                      )}

                      {/* Approve button - hidden when editing or already approved */}
                      {draft.status === "drafted" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            approveDraft(draft.id);
                          }}
                          disabled={approvingId === draft.id}
                        >
                          {approvingId === draft.id ? "Approving..." : "Approve"}
                        </button>
                      )}

                      {/* Green Approved indicator + Send Reminder */}
                      {isApproved && !isSent && (
                        <>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 6,
                              fontSize: 13,
                              fontWeight: 600,
                              background: "#34d39922",
                              color: "#34d399",
                              border: "1px solid #34d39944",
                            }}
                          >
                            <span style={{ fontSize: 16 }}>&#10003;</span>
                            Approved
                          </span>
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              sendReminder(draft.id);
                            }}
                            disabled={remindingId === draft.id}
                            style={{
                              color: "#fbbf24",
                              borderColor: "#fbbf2444",
                              fontSize: 13,
                            }}
                          >
                            {remindingId === draft.id ? "Sending..." : "Send Reminder"}
                          </button>
                        </>
                      )}

                      {/* Discard button - hidden when editing or approved */}
                      {!isSent && draft.status !== "discarded" && !isApproved && !isEditing && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            discardDraft(draft.id);
                          }}
                          disabled={discardingId === draft.id}
                          style={{
                            color: "#f87171",
                            borderColor: "#f8717144",
                          }}
                        >
                          {discardingId === draft.id ? "Discarding..." : "Discard"}
                        </button>
                      )}

                      {/* Add to Training (sent only) */}
                      {isSent && draft.added_to_training && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#34d39922",
                            color: "#34d399",
                            border: "1px solid #34d39944",
                          }}
                        >
                          <span style={{ fontSize: 16 }}>&#10003;</span>
                          Added to Training
                        </span>
                      )}
                      {isSent && !draft.added_to_training && (
                        <button
                          className="btn btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTrainingDraftId(
                              trainingDraftId === draft.id ? null : draft.id
                            );
                          }}
                        >
                          Add to Training
                        </button>
                      )}

                      {/* Lead status update buttons */}
                      {(() => {
                        // Determine effective lead status: per-draft update takes priority, then Salesforce
                        const effectiveStatus = draft.lead_status_update
                          ?? (draft.salesforce_lead_status?.toLowerCase() === "nurture_active" ? "nurture_active" : null)
                          ?? (draft.salesforce_lead_status?.toLowerCase() === "disqualified" ? "disqualified" : null);

                        if (effectiveStatus === "nurture_active") {
                          return (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 14px",
                                borderRadius: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                background: "#34d39922",
                                color: "#34d399",
                                border: "1px solid #34d39944",
                              }}
                            >
                              <span style={{ fontSize: 16 }}>&#10003;</span>
                              {draft.lead_status_update === "nurture_active" ? "Updated to Nurture Active" : "Nurture Active"}
                            </span>
                          );
                        }

                        if (effectiveStatus === "disqualified") {
                          return (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 14px",
                                borderRadius: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                background: "#f8717122",
                                color: "#f87171",
                                border: "1px solid #f8717144",
                              }}
                            >
                              <span style={{ fontSize: 16 }}>&#10003;</span>
                              {draft.lead_status_update === "disqualified" ? "Updated to Disqualified" : "Disqualified"}
                            </span>
                          );
                        }

                        if (isEditing) return null;

                        return (
                          <>
                            <button
                              className="btn btn-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateLeadStatus(draft.id, "nurture_active");
                              }}
                              disabled={leadStatusUpdatingId === draft.id}
                              style={{
                                color: "#34d399",
                                borderColor: "#34d39944",
                              }}
                            >
                              {leadStatusUpdatingId === draft.id ? "Updating..." : "Update to Nurture Active"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateLeadStatus(draft.id, "disqualified");
                              }}
                              disabled={leadStatusUpdatingId === draft.id}
                              style={{
                                color: "#f87171",
                                borderColor: "#f8717144",
                              }}
                            >
                              {leadStatusUpdatingId === draft.id ? "Updating..." : "Update to Disqualified"}
                            </button>
                          </>
                        );
                      })()}

                      {/* Agent Handoff Transfer — visible in sent area, or in drafts after nurture active */}
                      {(isSent || draft.lead_status_update === "nurture_active" || draft.salesforce_lead_status?.toLowerCase() === "nurture_active") && !draft.agent_handoff_transferred && (() => {
                        // Non-frontlines owned: show disabled "Already Owned" button
                        const isNonFrontlinesOwned =
                          draft.salesforce_owner_name &&
                          draft.is_master_agent_owned === false;

                        if (isNonFrontlinesOwned) {
                          return (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 14px",
                                borderRadius: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                background: "#fbbf2422",
                                color: "#fbbf24",
                                border: "1px solid #fbbf2444",
                                cursor: "default",
                              }}
                              title="This lead is already owned by an agent in Salesforce"
                            >
                              Already Owned by {draft.salesforce_owner_name}
                            </span>
                          );
                        }

                        // Must be marked Nurture Active before handoff is available
                        const isNurtureActive = draft.lead_status_update === "nurture_active"
                          || draft.salesforce_lead_status?.toLowerCase() === "nurture_active";
                        if (!isNurtureActive) {
                          return null;
                        }

                        return (
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHandoffPickerDraftId(
                                handoffPickerDraftId === draft.id ? null : draft.id
                              );
                              setHandoffSelectedAgentId(null);
                            }}
                            disabled={handoffId === draft.id}
                            style={{
                              color: "#a78bfa",
                              borderColor: "#a78bfa44",
                            }}
                          >
                            {handoffId === draft.id
                              ? "Transferring..."
                              : "Transfer to Agent"}
                          </button>
                        );
                      })()}

                      {/* Already transferred indicator */}
                      {isSent && draft.agent_handoff_transferred && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#a78bfa22",
                            color: "#a78bfa",
                            border: "1px solid #a78bfa44",
                          }}
                        >
                          <span style={{ fontSize: 16 }}>&#10003;</span>
                          Handed Off{draft.agents ? ` to ${draft.agents.name}` : ""}
                        </span>
                      )}
                    </div>

                    {/* Approve result banner - only on Drafts tab */}
                    {!isSent && approveResult && expandedId === draft.id && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "10px 14px",
                          background: approveResult.startsWith("Approved") || approveResult.startsWith("Reminder sent")
                            ? "#34d39922"
                            : "#f8717122",
                          border: `1px solid ${approveResult.startsWith("Approved") || approveResult.startsWith("Reminder sent") ? "#34d39944" : "#f8717144"}`,
                          borderRadius: 6,
                          fontSize: 13,
                          color: approveResult.startsWith("Approved") || approveResult.startsWith("Reminder sent")
                            ? "#34d399"
                            : "#f87171",
                        }}
                      >
                        {approveResult}
                      </div>
                    )}

                    {/* Agent handoff picker */}
                    {handoffPickerDraftId === draft.id && (
                      <div
                        style={{
                          marginBottom: 16,
                          padding: "14px 16px",
                          background: "#111318",
                          border: "1px solid #a78bfa44",
                          borderRadius: 6,
                        }}
                      >
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 10,
                            color: "#a78bfa",
                          }}
                        >
                          Transfer Lead to Agent in Salesforce
                        </label>
                        <p
                          className="text-muted text-sm"
                          style={{ marginBottom: 12 }}
                        >
                          Select an agent to transfer ownership to. This will update Salesforce via Zapier.
                        </p>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <select
                            className="form-input"
                            value={handoffSelectedAgentId ?? ""}
                            onChange={(e) => setHandoffSelectedAgentId(e.target.value || null)}
                            style={{ width: "100%", fontSize: 13 }}
                          >
                            <option value="">Select an agent...</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.email})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setHandoffPickerDraftId(null);
                              setHandoffSelectedAgentId(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => {
                              if (handoffSelectedAgentId) {
                                triggerAgentHandoff(draft.id, handoffSelectedAgentId);
                              }
                            }}
                            disabled={!handoffSelectedAgentId || handoffId === draft.id}
                            style={{
                              background: "#a78bfa",
                              borderColor: "#a78bfa",
                              color: "#111318",
                              opacity: !handoffSelectedAgentId ? 0.5 : 1,
                            }}
                          >
                            {handoffId === draft.id ? "Transferring..." : "Transfer"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add to training form */}
                    {trainingDraftId === draft.id && (
                      <div
                        style={{
                          marginBottom: 16,
                          padding: "14px 16px",
                          background: "#111318",
                          border: "1px solid #2a2e3a",
                          borderRadius: 6,
                        }}
                      >
                        <label
                          className="text-sm"
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: 10,
                            color: "#e4e6ed",
                          }}
                        >
                          Add to Training Data
                        </label>
                        <p
                          className="text-muted text-sm"
                          style={{ marginBottom: 12 }}
                        >
                          This will save the inbound email and the sent response as a training example.
                        </p>
                        <div className="form-group" style={{ marginBottom: 12 }}>
                          <label className="text-sm text-muted">Category</label>
                          <select
                            className="form-input"
                            value={trainingCategory}
                            onChange={(e) =>
                              setTrainingCategory(e.target.value as TrainingCategory)
                            }
                            style={{ width: "100%", fontSize: 13 }}
                          >
                            {CATEGORY_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            onClick={() => setTrainingDraftId(null)}
                            disabled={addingToTraining}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => addToTraining(draft.id)}
                            disabled={addingToTraining}
                          >
                            {addingToTraining ? "Adding..." : "Add to Training"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Conversation thread (newest on top from API) */}
                    {renderThreadMessages()}

                    {/* Minimal meta row - just created & sent times */}
                    <div
                      className="text-sm text-muted"
                      style={{
                        marginTop: 14,
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        Created: {new Date(draft.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
                      </span>
                      {draft.approved_at && (
                        <span>
                          Approved: {new Date(draft.approved_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
                        </span>
                      )}
                      {draft.sent_at && (
                        <span>
                          Sent: {new Date(draft.sent_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
                        </span>
                      )}
                      {isSent && draft.response_time_ms != null && (
                        <span>
                          Response Time: {formatResponseTime(draft.response_time_ms)}
                        </span>
                      )}
                      {draft.cc_emails.length > 0 && (
                        <span>
                          CC:{" "}
                          {draft.cc_emails.map((cc, i) => {
                            const agentName = ccAgentNames[i];
                            return agentName ? `${agentName} (${cc})` : cc;
                          }).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
                  );
                })}
                {(() => {
                  const showing = inboxShowCount.get(inboxKey) ?? INBOX_PAGE_SIZE;
                  const total = group.drafts.length;
                  const remaining = total - showing;
                  if (remaining <= 0 && showing <= INBOX_PAGE_SIZE) return null;
                  return (
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      {remaining > 0 && (
                        <button
                          onClick={() => setInboxShowCount((prev) => {
                            const next = new Map(prev);
                            next.set(inboxKey, showing + INBOX_PAGE_SIZE);
                            return next;
                          })}
                          style={{
                            flex: 1,
                            background: "none",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--accent)",
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "8px 16px",
                            cursor: "pointer",
                            textAlign: "center",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--bg-card-hover)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "none";
                            e.currentTarget.style.borderColor = "var(--border)";
                          }}
                        >
                          Show More ({remaining} remaining)
                        </button>
                      )}
                      {showing > INBOX_PAGE_SIZE && (
                        <button
                          onClick={() => setInboxShowCount((prev) => {
                            const next = new Map(prev);
                            next.delete(inboxKey);
                            return next;
                          })}
                          style={{
                            flex: remaining > 0 ? undefined : 1,
                            background: "none",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text-muted)",
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "8px 16px",
                            cursor: "pointer",
                            textAlign: "center",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--bg-card-hover)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "none";
                            e.currentTarget.style.borderColor = "var(--border)";
                          }}
                        >
                          Show Less
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function EmailDraftsPage() {
  return (
    <Suspense>
      <EmailDraftsPageInner />
    </Suspense>
  );
}
