import type { ReactNode } from "react";
import { Link } from "react-router";

const UPDATED = "3 November 2026";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="card enter mx-auto max-w-2xl space-y-4 p-6 text-[15px] leading-7 text-stone-700 sm:p-10 [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline-offset-2 hover:[&_a]:underline [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-stone-900 [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-stone-400">
      <h1 className="page-title text-stone-900">{title}</h1>
      <p className="text-xs text-stone-500">Last updated {UPDATED}</p>
      {children}
    </article>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p>
        AuctionHub ("we", "the app") lets people host and join live auctions. This policy explains what data we collect and how we
        use it.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li>Account data: your email address, plus your name and profile picture if you sign in with Google.</li>
        <li>Profile data you choose to add: display name, username, avatar.</li>
        <li>Optional contact details you choose to add: phone number and a short note.</li>
        <li>Auction activity: auctions and lots you create, bids you place, league teams you create, chat and deal-chat messages you send.</li>
        <li>Media you upload: photos, videos, cover images.</li>
        <li>Technical data: a sign-in session stored in your browser's local storage, and standard server logs (IP address, browser type).</li>
        <li>Error reports: if the app crashes, a technical error report (page, browser, error message) may be sent to our error monitoring service. It contains no account details, IP address or cookies.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To sign you in and keep you signed in.</li>
        <li>To run auctions: show bids, decide winners, show chat and media to other participants.</li>
        <li>To prevent abuse, such as rate limits, mutes and bans.</li>
      </ul>
      <p>We do not sell your data, and we do not use it for advertising.</p>

      <h2>What other users can see</h2>
      <p>
        Your display name, avatar, bids, league team, chat messages and uploaded media are visible to other users of the auction. We
        never use your email or Google name to create your public profile. Your auto-bid maximums are never shown.
      </p>
      <p>
        Your email, phone and note are <strong>private by default</strong>. They are shared only if you turn on "Share my contact
        details after a sale" in your account, and then only with the other side of a completed sale (the host of a lot you won, or
        the winner of a lot you sold). Deal-chat messages are visible only to that host and winner.
      </p>
      <p>
        <strong>Platform administrators</strong> (the operator of AuctionHub) can access all data on the service, including private
        auctions, contact details and deal-chat messages, to keep the platform safe, investigate abuse and fraud, provide support and
        comply with the law. Administrator actions such as bans and auction removals are recorded in an audit log.
      </p>

      <h2>Google sign-in</h2>
      <p>
        If you sign in with Google, we receive your name, email address and profile picture. We use them only to create and show
        your account. Our use of Google data follows the Google API Services User Data Policy, including its Limited Use
        requirements.
      </p>

      <h2>Service providers</h2>
      <ul>
        <li>Supabase: database, authentication, file storage (servers in Mumbai, India).</li>
        <li>Cloudflare: website hosting and delivery.</li>
        <li>Google: optional sign-in.</li>
        <li>YouTube / Twitch: if a host embeds a live stream, those players follow their own privacy policies.</li>
      </ul>

      <h2>Retention and deletion</h2>
      <p>We automatically delete data we no longer need:</p>
      <ul>
        <li>Chat messages removed by a moderator: after 1 day.</li>
        <li>Auction chat: 30 days after the auction ends.</li>
        <li>Auto-bid maximums: 7 days after a lot closes.</li>
        <li>Full bid history: 90 days after the auction ends (only each lot's final bid is kept).</li>
        <li>Deal-chat messages: 180 days after the sale.</li>
        <li>Cancelled auctions: 30 days after cancellation. Empty drafts: after 30 days without changes.</li>
        <li>Uploaded files that are no longer used (deleted auctions, replaced photos): within a few days.</li>
      </ul>
      <p>Hosts can delete their draft, ended or cancelled auctions at any time, which removes the auction's lots, bids, chat and files.</p>
      <p>
        We keep the rest of your data while your account exists. To delete your account and personal data, open a request at{" "}
        <Link className="underline" to="/support">
          the support form
        </Link>
        . Bid records tied to completed sales may be kept where needed to resolve disputes.
      </p>

      <h2>Cookies</h2>
      <p>We use browser local storage only to keep you signed in. We do not use tracking or advertising cookies.</p>

      <h2>Changes</h2>
      <p>We will update this page if this policy changes.</p>

      <h2>Contact</h2>
      <p>
        Questions:{" "}
        <Link className="underline" to="/support">
          the support form
        </Link>
      </p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of Service">
      <p>By using AuctionHub you agree to these terms.</p>

      <h2>Accounts</h2>
      <p>You are responsible for your account and everything done with it. Give accurate information. One person, one account.</p>

      <h2>Bids are binding</h2>
      <p>
        A bid is an offer to buy at that price. If you win a lot, you agree to complete the purchase with the host. Auto-bids
        count as your bids.
      </p>

      <h2>Hosts</h2>
      <ul>
        <li>Describe lots honestly, and only sell items you have the right to sell.</li>
        <li>No illegal, stolen, counterfeit or prohibited items.</li>
        <li>Payment, delivery and returns are arranged between host and buyer. AuctionHub does not process payments.</li>
      </ul>

      <h2>Conduct</h2>
      <p>
        No shill bidding, harassment, spam or abusive content in chat. Hosts and moderators may remove messages and mute users. We
        may suspend accounts that break these rules.
      </p>

      <h2>Content</h2>
      <p>You keep ownership of what you upload. You allow us to store and display it to run the service.</p>

      <h2>No warranty</h2>
      <p>
        The service is provided "as is". We are not a party to sales between users and are not liable for disputes, items or
        losses arising from auctions.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. Continued use means you accept the updated terms.</p>
    </Doc>
  );
}
