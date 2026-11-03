import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { supabase, errorMessage } from "../lib/supabase";
import { uploadMedia } from "../lib/media";

export function Account() {
  const { session, profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setUsername(profile.username);
    }
  }, [profile]);

  if (!profile || !session) return <p className="text-sm text-stone-500">Loading...</p>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.from("profiles").update({ display_name: displayName, username }).eq("id", profile!.id);
    setStatus(error ? errorMessage(error) : "Saved");
    await refreshProfile();
    setBusy(false);
  }

  async function avatar(file: File) {
    setBusy(true);
    try {
      const { url } = await uploadMedia("avatars", profile!.id, file, { maxSide: 256, maxMB: 0.1 });
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile!.id);
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      setStatus(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="mt-1 text-sm text-stone-500">{session.user.email}</p>

      <div className="mt-6 flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-stone-200">
          {profile.avatar_url && <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <label className="btn-ghost cursor-pointer">
          Change photo
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void avatar(e.target.files[0])} />
        </label>
      </div>

      <form onSubmit={save} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="dn">
            Display name
          </label>
          <input id="dn" className="input" required maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="un">
            Username
          </label>
          <input
            id="un"
            className="input"
            required
            pattern="[a-zA-Z0-9_]{3,24}"
            title="3-24 letters, numbers or underscores"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        {status && <p className="text-sm text-stone-600">{status}</p>}
        <button className="btn-primary" disabled={busy}>
          Save
        </button>
      </form>
    </div>
  );
}
