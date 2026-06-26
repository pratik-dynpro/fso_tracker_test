## ✅ Your checklist

**1. Create a Neon database** → get `DATABASE_URL`

- Sign up at [neon.tech](https://neon.tech/) (free)
- Create a project → open **Connection Details**
- Copy the **Pooled connection** string (the one with `-pooler` in it)

**2. Create a Google Maps API key** → get `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

- Go to [Google Cloud Console](https://console.cloud.google.com/) → create/select a project
- **APIs & Services → Library** → enable **Maps JavaScript API**
- **Credentials → Create credentials → API key** → copy it
- (Recommended) set a daily quota cap + billing budget alert

**3. Paste both into [.env.local](vscode-webview://0lbejvui7rtmlhgoh8lgpqo5g8klb88abvbe0edphj7jclp5rqhd/.env.local)** (already created for you)



```
DATABASE_URL=<paste Neon pooled string>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<paste Maps key>
INGEST_SECRET=        ← leave blank for now
```

**4. Tell me "done"** — then I run for you:

- `npm run db:setup` (creates the tables in Neon)
- `npm run dev` (starts the app so you can click through `/dispatch` and `/track`)

**5. Deploy to Vercel** (when local test looks good)

- Sign up at [vercel.com](https://vercel.com/) (free)
- Push the folder to GitHub (I can init the repo for you), import it in Vercel
- Add the **same two env vars** in Vercel → Settings → Environment Variables
- Deploy → you get an `https://…vercel.app` URL

**6. Field test** — open `https://…vercel.app/track` on the driver's phone, tap Start; watch `/dispatch` on your laptop.

------

### What you need to sign up for

| Service     | Cost      | Purpose                                        |
| ----------- | --------- | ---------------------------------------------- |
| Neon        | Free      | Database                                       |
| Google Maps | Free tier | The map                                        |
| Vercel      | Free      | Hosting                                        |
| GitHub      | Free      | Push code to Vercel (optional — CLI works too) |

The only thing blocking me right now is **steps 1–3** (the two credentials). Paste them into `.env.local`, say the word, and I'll take it from there.