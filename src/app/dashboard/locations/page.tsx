"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Location } from "@/lib/supabase/types";

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetId = useRef<string | null>(null);

  const fetchLocations = useCallback(() => {
    fetch("/api/internal/locations")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLocations(data);
        else setError(data.error ?? "Failed to load");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  function openAdd() {
    setEditing(null);
    setForm({ name: "", slug: "", is_active: true });
    setShowModal(true);
  }

  function openEdit(loc: Location) {
    setEditing(loc);
    setForm({ name: loc.name, slug: loc.slug, is_active: loc.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch("/api/internal/locations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, ...form }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      } else {
        const res = await fetch("/api/internal/locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }
      setShowModal(false);
      fetchLocations();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function triggerPhotoUpload(locationId: string) {
    photoTargetId.current = locationId;
    photoInputRef.current?.click();
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const locId = photoTargetId.current;
    if (!file || !locId) return;
    setUploadingPhotoId(locId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "location");
      formData.append("id", locId);
      const res = await fetch("/api/internal/upload-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLocations((prev) =>
        prev.map((l) => (l.id === locId ? { ...l, photo_url: data.photo_url } : l))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhotoId(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>Locations</h2>
          <p>Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Locations</h2>
        <p>Manage communities and neighborhoods for lead routing</p>
      </div>

      {/* Hidden file input for photo uploads */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        style={{ display: "none" }}
      />

      {error ? (
        <div className="card">
          <div className="empty-state">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h3>{locations.length} locations</h3>
            <button className="btn btn-primary" onClick={openAdd}>
              + Add Location
            </button>
          </div>
          {locations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">&#9873;</div>
              <h3>No locations yet</h3>
              <p>Add locations that your agents cover.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Photo</th>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((loc) => (
                    <tr key={loc.id} onClick={() => openEdit(loc)} style={{ cursor: "pointer" }}>
                      <td>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            overflow: "hidden",
                            background: "var(--bg-input)",
                            border: "1px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                          onClick={(e) => { e.stopPropagation(); triggerPhotoUpload(loc.id); }}
                          title="Click to upload photo"
                        >
                          {uploadingPhotoId === loc.id ? (
                            <span className="text-muted" style={{ fontSize: 10 }}>...</span>
                          ) : loc.photo_url ? (
                            <img
                              src={loc.photo_url}
                              alt={loc.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <span className="text-muted" style={{ fontSize: 10 }}>+ Photo</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-dot ${loc.is_active ? "active" : "inactive"}`}
                        />
                        {loc.is_active ? "Active" : "Inactive"}
                      </td>
                      <td style={{ fontWeight: 600 }}>{loc.name}</td>
                      <td className="text-muted text-sm font-mono">
                        {new Date(loc.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? "Edit Location" : "Add Location"}</h3>

            <div className="form-group">
              <label>Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm({
                    ...form,
                    name,
                    slug: editing
                      ? form.slug
                      : name.toLowerCase().replace(/\s+/g, "-"),
                  });
                }}
                placeholder="Lakewood Ranch"
              />
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                Active
              </label>
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.name}
              >
                {saving ? "Saving..." : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
