# Connecting the shared database (Supabase)

Right now each phone keeps its own copy of the books. This connects all six
branches to one shared database, so a sale at Unit 20 shows on the owner's
dashboard straight away and stock is one number everyone sees.

It takes about ten minutes and costs nothing at CMN's size.

---

## Step 1 — Make the database

1. Go to **supabase.com** and sign up (the free plan is enough).
2. Click **New project**.
   - **Name:** `CMN Trading`
   - **Database password:** make one up and save it somewhere safe — you won't
     need it day to day, but you can't recover it later.
   - **Region:** **Southeast Asia (Singapore)** — the closest to Manila, so the
     app feels fast.
3. Wait about two minutes while it sets up.

## Step 2 — Create the tables

1. In the left menu click **SQL Editor** → **New query**.
2. Open `supabase/migrations/0002_cmn_app.sql` from this project, copy
   **everything** in it, and paste it into the editor.
3. Click **Run**. It should say *Success*.

That builds every table the app needs, switches on live updates, and sets the
access rules.

## Step 3 — Get the two keys

1. Left menu → **Project Settings** → **API**.
2. Copy these two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long string starting `eyJ…`

> Keep both private. Anyone with them can read and write your business data.
> Don't post them in a chat, an email thread, or a public page.

## Step 4 — Tell the app about them

1. Go to **vercel.com**, open the **CMN** project.
2. **Settings** → **Environment Variables**.
3. Add two variables, ticking **Production**, **Preview** and **Development**
   for each:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL from step 3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key from step 3 |

4. Go to the **Deployments** tab, open the newest deployment, and choose
   **Redeploy**. The app has to be rebuilt for the new settings to take effect.

## Step 5 — Load your data in, once

The **first device to open the app after this** uploads what it has into the
empty shared database. Everything after that is shared.

So: open the app on the phone or computer that already has your real price
list, and wait for the badge to say **All branches in sync**. That device's
data becomes the starting point for everyone.

If none of them has the real data yet, open the app anywhere, go to
**Products & Prices → Import price list**, upload your Excel, and that becomes
the shared catalogue.

Then open the app on the other branches' phones. They'll pull everything down.

## Step 6 — Check it worked

At the top of every screen, next to the branch name, there's a small dot:

| What you see | What it means |
|---|---|
| 🟢 **All branches in sync** | Connected. Everyone shares one set of books. |
| 🟠 **Saving…** | Sending a change up. Normal, lasts a second. |
| 🔴 **Offline — will send when back** | No internet. Keep working; it sends when the signal returns. |
| ⚪ **This device only** | Not connected to the shared database — check steps 4 and 5. |

The full version, with any error message, is in **Menu → Admin & Settings →
Data & sync**.

A good test: add a product on one phone, then open the app on another. It
should appear within a few seconds without anyone refreshing.

---

## Things worth knowing

**Working without signal.** If the internet drops, the branch keeps selling
normally — everything saves on the phone and uploads by itself when the signal
comes back. Nothing is lost.

**If two people edit the same thing at once**, the later save wins. In practice
branches work on their own stock, so this rarely comes up. The one case to
watch is two tills in the *same* branch selling at the same moment; receipt
numbers are re-checked against the shared database each time the app loads, so
gaps are possible but duplicates are unlikely.

**Who can get in.** Staff sign in with a PIN inside the app, not with a Supabase
account, so the app connects using the anon key and the access rules allow it
through. That means the two keys from step 3 *are* the lock on your data — keep
them private. If you ever need proper per-person accounts (so a leaked key
alone isn't enough), that's a further piece of work; ask and it can be added.

**Backups.** Supabase keeps its own daily backups on the free plan. The
**Admin → Save backup** button still works and is worth using before anything
big, like a full price-list re-import.

**Turning it off.** Remove the two environment variables in Vercel and
redeploy; the app goes back to keeping data on each device. The shared database
is left untouched, so you can switch back by putting them in again.
