# Hosting on Vercel — Complete Beginner's Guide
### McCarthy Tyre — Technician GPS Tracking

This walks you through putting the app online so anyone (your driver) can open it from a link. No prior Vercel experience needed. Take it one step at a time.

---

## What we're doing (the big picture)

```
Your code (on your PC)  ──push──►  GitHub (stores the code online)
                                        │
                                        ▼
                                     Vercel  ──builds & hosts──►  https://your-app.vercel.app
```

- **GitHub** = a free online home for your code.
- **Vercel** = takes that code and turns it into a live website with HTTPS, for free.
- Every time you change the code and push, Vercel **redeploys automatically**.

You'll do this once; after that it's automatic.

---

## Before you start — accounts you need (all free)

| Account | Sign up at | You already have? |
|---|---|---|
| GitHub | https://github.com/signup | (you have a GitHub bookmark — likely yes) |
| Vercel | https://vercel.com/signup | Sign up with your GitHub account (one click) |

You already have your **Neon database** and **Google Maps key** in `.env.local` — keep that file handy, you'll copy two values from it later.

---

## STEP 1 — Put your code on GitHub

> Your code is already committed locally (I did `git init` + first commit). Now it needs to go online.

### 1a. Create an empty repository on GitHub
1. Go to **https://github.com/new**
2. **Repository name:** `mccarthy-gps-tracking`
3. **Visibility:** choose **Private** (recommended — only you can see it)
4. **DO NOT** tick "Add a README", ".gitignore", or "license" — leave all unchecked (you already have these files)
5. Click **Create repository**

### 1b. Push your code up
GitHub will show you a page with commands. **Ignore them** — instead, copy the repository URL at the top (looks like `https://github.com/yourname/mccarthy-gps-tracking.git`) and **send it to me** — I'll push it for you.

Or run these yourself in a terminal in the project folder:
```bash
git remote add origin https://github.com/YOURNAME/mccarthy-gps-tracking.git
git branch -M main
git push -u origin main
```
> The first push will ask you to sign in to GitHub — a browser window pops up, click authorize.

When done, refresh the GitHub page — you'll see all your files there.

---

## STEP 2 — Sign up for Vercel

1. Go to **https://vercel.com/signup**
2. Click **Continue with GitHub** (easiest — links the two accounts)
3. Authorize Vercel when asked.
4. If it asks about a team/plan, choose the **Hobby (Free)** plan.

---

## STEP 3 — Import your project into Vercel

1. On the Vercel dashboard, click **Add New… → Project**
2. You'll see a list of your GitHub repositories. Find **mccarthy-gps-tracking** and click **Import**.
   - If you don't see it, click **Adjust GitHub App Permissions** and give Vercel access to the repo.
3. Vercel auto-detects it's a **Next.js** app — leave all the build settings at their defaults. **Don't click Deploy yet** — first do Step 4 below (environment variables) on this same screen.

---

## STEP 4 — Add your environment variables (THE most important step)

On the import screen there's a section called **Environment Variables**. The deployed app needs the same two secrets your local app uses. Open your `.env.local` file and copy the values.

Add these two (click "Add" after each):

| Name (paste exactly) | Value (copy from your `.env.local`) |
|---|---|
| `DATABASE_URL` | your Neon connection string (`postgresql://...`) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | your Google Maps key (`AIza...`) |

> Leave `INGEST_SECRET` out for now.
> ⚠️ If you skip this step, the live site won't reach the database (blank roster) and the map won't load.

---

## STEP 5 — Deploy

1. Click **Deploy**.
2. Wait ~1–2 minutes while Vercel builds it. You'll see logs scrolling.
3. When it finishes you'll see **🎉 Congratulations** and a screenshot of your site.
4. Click **Continue to Dashboard**, then **Visit** — your live URL is something like:
   `https://mccarthy-gps-tracking.vercel.app`

**Your pages:**
- Dispatch console: `https://your-app.vercel.app/dispatch`
- Technician tracker: `https://your-app.vercel.app/track`

---

## STEP 6 — Allow your new domain in Google Maps (so the map isn't blank)

If you restricted your Maps key to "Websites" earlier, the new Vercel domain isn't allowed yet:
1. Go to **Google Cloud Console → APIs & Services → Credentials**
2. Click your API key
3. Under **Application restrictions → Website restrictions**, click **Add** and enter:
   - `https://*.vercel.app/*`
   - (later, your custom domain if you add one)
4. **Save**. Wait a couple of minutes.

> If you set Application restrictions to **None** earlier, you can skip this step.

---

## STEP 7 — Test it

1. On **your laptop**, open `https://your-app.vercel.app/dispatch` — the Google Map should load.
2. On the **driver's device**, open `https://your-app.vercel.app/track`:
   - Enter a name → **Start trip** → **Allow** location.
3. Watch your dispatch screen — the driver appears as a marker, the roster fills in, distance ticks up.

> Reminder: a **laptop** reports coarse Wi-Fi/IP location (won't move smoothly while driving). A **phone** has real GPS and tracks properly. Same link works on both.

---

## Making changes later (auto-deploy)

Once connected, you never touch Vercel's dashboard to update. Just change the code and push:
```bash
git add -A
git commit -m "describe your change"
git push
```
Vercel sees the push and **automatically rebuilds and redeploys** in ~1 minute. (I can do this for you whenever you ask.)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Roster empty / "Connecting…" forever | `DATABASE_URL` missing or wrong in Vercel | Settings → Environment Variables → check it → **Redeploy** |
| Map area is grey / "add your key" | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` missing in Vercel | Add it → **Redeploy** |
| Map shows "For development purposes only" or blank | Domain not allowed on the Maps key | Step 6 — add `https://*.vercel.app/*` |
| `/track` says location blocked | Browser needs HTTPS + permission | Use the `https://` Vercel URL (not an IP), tap Allow |
| Changed env vars but nothing changed | Env vars only apply on a new build | Vercel → Deployments → **Redeploy** |
| Build failed | A code/config error | Send me the build log from Vercel and I'll fix it |

> After changing **any** environment variable in Vercel, you must **Redeploy** for it to take effect (Vercel → Deployments → ⋯ → Redeploy).

---

## Quick reference — your links

- Vercel dashboard: https://vercel.com/dashboard
- Your live app: `https://<your-project>.vercel.app`
- Dispatch: `…/dispatch`  ·  Technician: `…/track`
- GitHub repo: `https://github.com/<you>/mccarthy-gps-tracking`

---

**Stuck anywhere?** Tell me which step number and what you see on screen — I'll get you through it.
