import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { supabase, errorMessage } from "../lib/supabase";
import { uploadMedia } from "../lib/media";
import { Avatar } from "../components/Avatar";
import { ThemeSegmented } from "../components/ThemeToggle";
import { LanguagePicker } from "../components/LanguagePicker";
import { Link } from "react-router";

export function Account() {
  const { session, profile, refreshProfile, signOut } = useAuth();
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
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim(), username }).eq("id", profile!.id);
    setStatus(error ? (error.code === "23505" ? "That username is taken" : errorMessage(error)) : "Profile saved");
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

  async function removeAvatar() {
    await supabase.from("profiles").update({ avatar_url: null }).eq("id", profile!.id);
    await refreshProfile();
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="page-title enter">Account</h1>

      <section className="card enter space-y-5 p-5 sm:p-6" style={{ ["--i" as string]: 1 }}>
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <Avatar name={profile.display_name} url={profile.avatar_url} size={80} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-extrabold tracking-tight">{profile.display_name}</p>
            <p className="truncate text-sm text-stone-500">
              {profile.username && (
                <Link to={`/u/${profile.username}`} className="font-medium text-brand-700 hover:underline">
                  @{profile.username}
                </Link>
              )}{" "}
              · {session.user.email} <span className="text-xs">(only you see this)</span>
            </p>
          </div>
        </div>
        <div>
          <h2 className="section-title">Public profile</h2>
          <p className="text-sm text-stone-500">Everyone in an auction can see this. Don't use your real name if you prefer not to.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="btn-ghost cursor-pointer">
            Upload photo
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void avatar(e.target.files[0])} />
          </label>
          {profile.avatar_url && (
            <button className="text-sm text-stone-500 hover:text-red-600" onClick={() => void removeAvatar()}>
              Remove
            </button>
          )}
        </div>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          {status && <p className="text-sm text-stone-600">{status}</p>}
          <button className="btn-primary" disabled={busy}>
            Save profile
          </button>
        </form>
      </section>

      <section className="enter space-y-2" style={{ ["--i" as string]: 2 }}>
        <h2 className="label px-4">Appearance &amp; language</h2>
        <div className="group-list">
          <div className="group-row flex-wrap justify-between">
            <span className="text-sm font-medium">Theme</span>
            <ThemeSegmented />
          </div>
          <div className="group-row flex-wrap justify-between">
            <span className="text-sm font-medium">Language</span>
            <div className="w-48">
              <LanguagePicker full />
            </div>
          </div>
        </div>
        <p className="px-4 text-xs text-stone-500">System follows your device's light or dark setting.</p>
      </section>

      <ContactPrivacy userId={profile.id} email={session.user.email ?? ""} />

      <div className="group-list">
        <button className="group-row w-full justify-center text-sm font-semibold text-red-600 transition hover:bg-red-50" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function ContactPrivacy({ userId, email }: { userId: string; email: string }) {
  const [share, setShare] = useState(false);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from("contact_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setShare(data.share_contact);
          setPhone(data.phone ?? "");
          setNote(data.note ?? "");
        }
      });
  }, [userId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("contact_settings")
      .upsert({ user_id: userId, share_contact: share, phone: phone.trim() || null, note: note.trim() || null });
    setBusy(false);
    setStatus(error ? errorMessage(error) : "Privacy settings saved");
  }

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="section-title">Privacy &amp; contact</h2>
        <p className="text-sm text-stone-500">
          Your email and phone are <strong>private by default</strong>. After a sale, hosts and winners can always talk in the private deal
          chat without sharing them.
        </p>
      </div>
      <form onSubmit={save} className="space-y-4">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl bg-stone-900/[0.04] p-4 dark:bg-snow/[0.05]">
          <span>
            <span className="block text-sm font-semibold">Share my contact details after a sale</span>
            <span className="block text-xs text-stone-500">
              When on, the other side of a completed sale (the host of a lot you won, or the winner of a lot you sold) can see your email
              {email && ` (${email})`}
              {phone ? `, phone` : ""} and note. Nobody else ever sees them.
            </span>
          </span>
          <input type="checkbox" className="switch mt-0.5" checked={share} onChange={(e) => setShare(e.target.checked)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ph">
              Phone / WhatsApp (optional)
            </label>
            <input id="ph" className="input" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="nt">
              Note for buyers/sellers (optional)
            </label>
            <input id="nt" className="input" maxLength={200} placeholder="e.g. UPI accepted, pickup in Pune" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {status && <p className="text-sm text-stone-600">{status}</p>}
        <button className="btn-primary" disabled={busy}>
          Save privacy settings
        </button>
      </form>
    </section>
  );
}
