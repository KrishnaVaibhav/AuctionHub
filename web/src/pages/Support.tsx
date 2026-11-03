import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const CATEGORIES = [
  ["question", "Question"],
  ["abuse", "Report abuse or fraud"],
  ["data", "My data / delete my account"],
  ["bug", "Something is broken"],
  ["other", "Other"],
] as const;

export function Support() {
  const { session } = useAuth();
  const [category, setCategory] = useState<string>("question");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("support_requests").insert({
      user_id: session?.user.id ?? null,
      category,
      message: message.trim(),
      contact: contact.trim() || null,
    });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="font-display text-2xl font-bold">Thanks, we got it</p>
        <p className="mt-2 text-sm text-stone-500">
          {session ? "We'll follow up on your account if needed." : contact ? "We'll reply using the contact you gave." : "We read every message."}
        </p>
        <Link to="/" className="btn-primary mt-6">
          Back to auctions
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Contact support</h1>
        <p className="mt-1 text-sm text-stone-500">Questions, abuse reports, data or account deletion requests. Only the platform team can read these.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="cat">
            Topic
          </label>
          <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="msg">
            Message
          </label>
          <textarea
            id="msg"
            className="input min-h-36"
            required
            minLength={10}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what happened. Include the auction link if it's about a specific auction."
          />
        </div>
        {!session && (
          <div>
            <label className="label" htmlFor="contact">
              How can we reply? (optional)
            </label>
            <input id="contact" className="input" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or other contact" />
            <p className="mt-1 text-xs text-stone-500">Leave empty to stay anonymous. Signed-in users are answered through their account.</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
